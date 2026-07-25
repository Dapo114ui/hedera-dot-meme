// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOnycBondingCurve} from "./IOnycBondingCurve.sol";
import {BondingCurveMath} from "./BondingCurveMath.sol";
import {IHederaTokenService, HTS_SUCCESS} from "./IHederaTokenService.sol";

/// @notice Minimal ERC20 view used only to read this contract's own HTS
/// token balance for graduation/inventory sanity checks - HTS tokens are
/// reachable through a standard ERC20 facade at their own address.
interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @title OnycBondingCurve
/// @notice Implementation of IOnycBondingCurve - see that file for the full
/// design writeup (curve choice, decimals convention, HTS constraints).
/// This contract is the treasury for every token it creates: the entire
/// fixed supply mints to itself at create() time, and buy()/sell() only
/// ever move already-minted tokens between itself and traders.
contract OnycBondingCurve is IOnycBondingCurve {
    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    /// @dev Real precompile address in production; overridden to a mock in
    /// tests via the constructor (see htsPrecompile below).
    address internal constant DEFAULT_HTS_PRECOMPILE = address(0x167);

    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** 8;
    uint256 internal constant CURVE_SUPPLY = 800_000_000 * 10 ** 8;
    // TOTAL_SUPPLY - CURVE_SUPPLY stays held by this contract, earmarked
    // for future DEX-liquidity seeding at graduation - a v2 feature this
    // contract does not implement.
    //
    // 300 HBAR in tinybars (8 decimals). Confirmed live on Hedera testnet
    // (see contracts/test/ValueScaleProbe.sol and scripts/probe-value-scale.cjs)
    // that msg.value and address(this).balance inside contract execution
    // are in native 8-decimal tinybars, NOT the 18-decimal "weibar"
    // convention the outer JSON-RPC transaction's value field and
    // eth_getBalance use - those two only agree at the RPC boundary, not
    // inside the EVM. Every HBAR-denominated amount in this contract is
    // in tinybars for that reason.
    uint256 internal constant INITIAL_VIRTUAL_HBAR_RESERVE = 300 * 10 ** 8;

    /// @dev Generous flat buffer (tinybars) forwarded to the HTS precompile
    /// to cover the network's own real token-creation cost (~$1, i.e.
    /// roughly 15-20 HBAR depending on the exchange rate). Hedera refunds
    /// whatever of this the precompile doesn't actually use back into this
    /// contract's own balance - see create() below, which then sweeps
    /// that refund (msg.value minus the real HTS cost) to platformTreasury
    /// as this platform's margin. Matches the exact HBAR number this
    /// project's own archived HTS attempts used successfully (rescaled
    /// here to tinybars).
    uint256 internal constant HTS_CREATION_BUFFER_TINYBARS = 40 * 10 ** 8;

    uint16 internal constant MAX_TRADING_FEE_BPS = 500; // 5% hard cap

    // ------------------------------------------------------------------
    // Immutable configuration
    // ------------------------------------------------------------------

    address public immutable platformTreasury;
    uint256 public immutable creationFeeTinybarsValue;
    uint16 public immutable tradingFeeBpsValue;
    uint256 public immutable fundingGoalValue;

    /// @dev Injectable so tests can point this at a mock instead of the
    /// real 0x167 precompile, which doesn't exist on a standard local EVM.
    /// Production deploys pass DEFAULT_HTS_PRECOMPILE.
    IHederaTokenService internal immutable htsPrecompile;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    mapping(address => MemeToken) internal _memeTokens;

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    constructor(
        address _platformTreasury,
        uint256 _creationFeeTinybars,
        uint16 _tradingFeeBps,
        uint256 _fundingGoalTinybars,
        address _htsPrecompile
    ) {
        require(_platformTreasury != address(0), "treasury cannot be zero address");
        require(
            _creationFeeTinybars >= HTS_CREATION_BUFFER_TINYBARS,
            "creation fee must cover HTS network cost"
        );
        require(_tradingFeeBps <= MAX_TRADING_FEE_BPS, "trading fee too high");
        require(_fundingGoalTinybars > 0, "funding goal must be positive");

        platformTreasury = _platformTreasury;
        creationFeeTinybarsValue = _creationFeeTinybars;
        tradingFeeBpsValue = _tradingFeeBps;
        fundingGoalValue = _fundingGoalTinybars;
        htsPrecompile = IHederaTokenService(
            _htsPrecompile == address(0) ? DEFAULT_HTS_PRECOMPILE : _htsPrecompile
        );
    }

    // ------------------------------------------------------------------
    // Write functions
    // ------------------------------------------------------------------

    /// @inheritdoc IOnycBondingCurve
    function create(
        string calldata name,
        string calldata symbol,
        string calldata memo
    ) external payable override returns (address tokenAddress) {
        if (msg.value != creationFeeTinybarsValue) {
            revert IncorrectCreationFee(creationFeeTinybarsValue, msg.value);
        }
        require(bytes(memo).length <= 100, "memo exceeds HTS 100-byte limit");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](0);

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry({
            second: 0,
            autoRenewAccount: address(this),
            autoRenewPeriod: 7776000 // 90 days
        });

        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: memo,
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: expiry
        });

        int64 responseCode;
        (responseCode, tokenAddress) = htsPrecompile.createFungibleToken{
            value: HTS_CREATION_BUFFER_TINYBARS
        }(token, TOTAL_SUPPLY, 8);
        if (responseCode != HTS_SUCCESS) revert HtsTokenCreationFailed(responseCode);

        _memeTokens[tokenAddress] = MemeToken({
            tokenAddress: tokenAddress,
            creatorAddress: msg.sender,
            virtualHbarReserve: INITIAL_VIRTUAL_HBAR_RESERVE,
            virtualTokenReserve: CURVE_SUPPLY,
            realHbarReserve: 0,
            tokensSold: 0,
            graduated: false
        });

        // Hedera refunds whatever of HTS_CREATION_BUFFER_TINYBARS the
        // precompile didn't actually spend back into this contract's own
        // balance. What's left after that (msg.value - real HTS cost) is
        // this platform's margin on the flat creation fee - sweep it to
        // treasury now rather than leaving it stranded in the contract.
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool ok, ) = platformTreasury.call{value: remaining}("");
            require(ok, "treasury sweep failed");
        }

        emit MemeCreated(tokenAddress, msg.sender, name, symbol);
    }

    /// @inheritdoc IOnycBondingCurve
    function buy(
        address tokenAddress,
        uint256 minTokensOut
    ) external payable override returns (uint256 tokensOut) {
        MemeToken storage meme = _memeTokens[tokenAddress];
        if (meme.tokenAddress == address(0)) revert TokenNotFound(tokenAddress);
        if (meme.graduated) revert TokenAlreadyGraduated(tokenAddress);
        if (msg.value == 0) revert ZeroAmount();

        (uint256 hbarInAfterFee, uint256 feeAmount) = BondingCurveMath.applyFee(
            msg.value,
            tradingFeeBpsValue
        );

        tokensOut = BondingCurveMath.quote(
            meme.virtualHbarReserve,
            meme.virtualTokenReserve,
            hbarInAfterFee
        );
        if (tokensOut < minTokensOut) revert BuySlippageExceeded(minTokensOut, tokensOut);
        // Can never actually exceed virtualTokenReserve (the curve math
        // asymptotically approaches but never reaches full reserve
        // drainage), but guard explicitly rather than rely on that alone.
        require(tokensOut < meme.virtualTokenReserve, "curve reserve exhausted");

        meme.virtualHbarReserve += hbarInAfterFee;
        meme.virtualTokenReserve -= tokensOut;
        meme.realHbarReserve += hbarInAfterFee;
        meme.tokensSold += tokensOut;

        if (feeAmount > 0) {
            (bool feeOk, ) = platformTreasury.call{value: feeAmount}("");
            require(feeOk, "fee transfer failed");
        }

        int64 transferResponse = htsPrecompile.transferToken(
            tokenAddress,
            address(this),
            msg.sender,
            int64(uint64(tokensOut))
        );
        if (transferResponse != HTS_SUCCESS) revert HtsTransferFailed(transferResponse);

        emit TokensBought(tokenAddress, msg.sender, tokensOut, msg.value);

        _maybeGraduate(meme);
    }

    /// @inheritdoc IOnycBondingCurve
    function sell(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minHbarOut
    ) external override returns (uint256 hbarOut) {
        MemeToken storage meme = _memeTokens[tokenAddress];
        if (meme.tokenAddress == address(0)) revert TokenNotFound(tokenAddress);
        if (meme.graduated) revert TokenAlreadyGraduated(tokenAddress);
        if (tokenAmount == 0) revert ZeroAmount();

        // Pull the tokens being sold from the seller first. Requires the
        // seller to have approved this contract to spend tokenAmount via
        // the HTS token's own ERC20 facade beforehand - standard
        // approve-then-swap UX, same shape as selling an ERC20 into any
        // EVM DEX.
        int64 pullResponse = htsPrecompile.transferToken(
            tokenAddress,
            msg.sender,
            address(this),
            int64(uint64(tokenAmount))
        );
        if (pullResponse != HTS_SUCCESS) revert HtsTransferFailed(pullResponse);

        uint256 hbarOutBeforeFee = BondingCurveMath.quote(
            meme.virtualTokenReserve,
            meme.virtualHbarReserve,
            tokenAmount
        );
        (uint256 hbarOutAfterFee, uint256 feeAmount) = BondingCurveMath.applyFee(
            hbarOutBeforeFee,
            tradingFeeBpsValue
        );
        hbarOut = hbarOutAfterFee;
        if (hbarOut < minHbarOut) revert SellSlippageExceeded(minHbarOut, hbarOut);
        require(hbarOutBeforeFee <= meme.realHbarReserve, "curve short on real HBAR");

        meme.virtualTokenReserve += tokenAmount;
        meme.virtualHbarReserve -= hbarOutBeforeFee;
        meme.realHbarReserve -= hbarOutBeforeFee;
        meme.tokensSold -= tokenAmount;

        if (feeAmount > 0) {
            (bool feeOk, ) = platformTreasury.call{value: feeAmount}("");
            require(feeOk, "fee transfer failed");
        }

        (bool sellOk, ) = msg.sender.call{value: hbarOut}("");
        require(sellOk, "HBAR payout failed");

        emit TokensSold(tokenAddress, msg.sender, tokenAmount, hbarOut);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _maybeGraduate(MemeToken storage meme) internal {
        if (!meme.graduated && meme.realHbarReserve >= fundingGoalValue) {
            meme.graduated = true;
            emit Graduated(meme.tokenAddress, meme.realHbarReserve);
        }
    }

    // ------------------------------------------------------------------
    // View functions
    // ------------------------------------------------------------------

    /// @inheritdoc IOnycBondingCurve
    function getAmountOut(
        address tokenAddress,
        uint256 amount,
        uint8 txType
    ) external view override returns (uint256) {
        MemeToken storage meme = _memeTokens[tokenAddress];
        if (meme.tokenAddress == address(0)) revert TokenNotFound(tokenAddress);
        if (amount == 0) revert ZeroAmount();

        if (txType == 0) {
            // Buy quote: amount is tokens wanted, returns HBAR cost
            // (before fee is added back on top, so this is the curve's
            // raw pre-fee price - matching memejob's own convention of
            // returning a pre-fee cost quote).
            return BondingCurveMath.quote(meme.virtualTokenReserve, meme.virtualHbarReserve, amount);
        } else {
            // Sell quote: amount is tokens to sell, returns HBAR proceeds
            // after the trading fee.
            uint256 hbarOutBeforeFee = BondingCurveMath.quote(
                meme.virtualHbarReserve,
                meme.virtualTokenReserve,
                amount
            );
            (uint256 hbarOutAfterFee, ) = BondingCurveMath.applyFee(hbarOutBeforeFee, tradingFeeBpsValue);
            return hbarOutAfterFee;
        }
    }

    /// @inheritdoc IOnycBondingCurve
    function previewBuy(
        address tokenAddress,
        uint256 hbarAmountIn
    ) external view override returns (uint256 tokensOut) {
        MemeToken storage meme = _memeTokens[tokenAddress];
        if (meme.tokenAddress == address(0)) revert TokenNotFound(tokenAddress);
        (uint256 hbarInAfterFee, ) = BondingCurveMath.applyFee(hbarAmountIn, tradingFeeBpsValue);
        tokensOut = BondingCurveMath.quote(meme.virtualHbarReserve, meme.virtualTokenReserve, hbarInAfterFee);
    }

    /// @inheritdoc IOnycBondingCurve
    function previewSell(
        address tokenAddress,
        uint256 tokenAmountIn
    ) external view override returns (uint256 hbarOut) {
        MemeToken storage meme = _memeTokens[tokenAddress];
        if (meme.tokenAddress == address(0)) revert TokenNotFound(tokenAddress);
        uint256 hbarOutBeforeFee = BondingCurveMath.quote(
            meme.virtualTokenReserve,
            meme.virtualHbarReserve,
            tokenAmountIn
        );
        (hbarOut, ) = BondingCurveMath.applyFee(hbarOutBeforeFee, tradingFeeBpsValue);
    }

    /// @inheritdoc IOnycBondingCurve
    function creationFeeTinybars() external view override returns (uint256) {
        return creationFeeTinybarsValue;
    }

    /// @inheritdoc IOnycBondingCurve
    function tradingFeeBps() external view override returns (uint16) {
        return tradingFeeBpsValue;
    }

    /// @inheritdoc IOnycBondingCurve
    function fundingGoal() external view override returns (uint256) {
        return fundingGoalValue;
    }

    /// @inheritdoc IOnycBondingCurve
    function memeTokens(address tokenAddress) external view override returns (MemeToken memory) {
        return _memeTokens[tokenAddress];
    }

    /// @dev Lets tests/off-chain tooling confirm this contract's real HTS
    /// balance for a token matches its own virtualTokenReserve + reserved
    /// (non-curve) allocation bookkeeping - a sanity check, not used by
    /// any external-facing flow.
    function curveTokenInventory(address tokenAddress) external view returns (uint256) {
        return IERC20Balance(tokenAddress).balanceOf(address(this));
    }

    /// @notice Accepts the HTS precompile's automatic refund of unused
    /// HTS_CREATION_BUFFER_TINYBARS during create(). Must exist for that
    /// refund to land rather than reverting the whole transaction.
    receive() external payable {}
}
