// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOnycBondingCurve
/// @notice Interface spec for Onyc.meme's own bonding-curve launchpad
/// contract - the planned replacement for the third-party, unverified
/// memejob contract (0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8) the app
/// currently calls. One deployed instance manages every token launched
/// through it, mirroring memejob's single-contract-plus-mapping shape so
/// the frontend rewrite (coin.js/mirror-trades.js/api/award-points.js)
/// stays small.
///
/// THIS IS AN INTERFACE, NOT AN IMPLEMENTATION. It fixes the external
/// shape (events, errors, function signatures) an implementing contract
/// must satisfy. The actual curve math, HTS calls, and storage layout are
/// the next phase.
///
/// ============================================================================
/// DESIGN SUMMARY
/// ============================================================================
///
/// Curve: virtual-reserve constant product (pump.fun-style), same family as
/// Uniswap V2's x*y=k. Chosen over a from-scratch formula because it's a
/// well-understood, minimal-attack-surface pattern - important given this
/// contract will hold real HBAR and needs an audit before mainnet use.
///
///   - Fixed total supply per token: 1,000,000,000 * 10**8 (8 decimals,
///     matching every existing HTS token this app displays).
///   - 800,000,000 * 10**8 of that goes into the curve's virtualTokenReserve;
///     the remaining 200,000,000 * 10**8 stays reserved in this contract,
///     earmarked for DEX-liquidity seeding at graduation - a v2 feature,
///     NOT built here. v1 just holds it.
///   - virtualHbarReserve starts at a small non-zero seed (recommend
///     ~300 HBAR-equivalent) so the first buy isn't priced at zero and so
///     create() never needs a forced initial buy the way memejob's
///     createToken() does (its "5 HBAR initial buy buffer to prevent
///     OVERFLOW(17)" workaround, see script.js's launch handler, is a
///     symptom of NOT pre-seeding virtual reserves - we avoid the whole
///     problem by seeding upfront).
///   - realHbarReserve tracks actual HBAR raised; graduation triggers at
///     realHbarReserve >= fundingGoal().
///
/// Fees: made explicit and contract-enforced, replacing three previously
/// opaque/inconsistent mechanisms (memejob's exchange-rate-precompile-
/// pegged creation fee, its unverifiable ~1.92% buy/sell spread, and this
/// app's own separate flat-fee-transfer-after-creation step):
///   - creationFeeTinybars(): flat, required as exact msg.value on create().
///     No precompile dependency - this is what removes the entire
///     "poll eth_estimateGas until the network accepts the fee" pre-flight
///     dance currently in script.js's launch handler (see the
///     waitForFeeWindow/isRetryableLaunchError block), which exists only
///     because memejob's fee depends on Hedera's exchange rate flipping on
///     an hourly boundary. A flat fee has no such edge case.
///   - tradingFeeBps(): basis points taken on every buy/sell, visible in
///     source instead of buried in curve asymmetry.
///
/// ============================================================================
/// THE TWO SHARP EDGES - both confirmed by this project's own prior,
/// abandoned attempt at a custom HTS contract (archive/contracts/, moved
/// out of the repo but kept on disk; see git log for
/// "Fix HTS Signature Issue" / "Fix HTS Contract Keys" / "Fix HTS token
/// treasury bug"). Read these before implementing - they were each hit
/// and fixed the hard way once already:
/// ============================================================================
///
/// 1. DECIMALS: two different scales coexist, and NEITHER is what an
///    Ethereum background would suggest. Confirmed live against a real
///    deployment on Hedera testnet (see contracts/test/ValueScaleProbe.sol
///    and scripts/probe-value-scale.cjs) after an initial deploy with
///    18-decimal constants failed every create() call with
///    IncorrectCreationFee, despite the caller sending an apparently
///    correct amount:
///      - Inside contract execution, msg.value and address(this).balance
///        report Hedera's native 8-decimal tinybars - e.g. sending "1 HBAR"
///        (encoded the standard EVM way, as 10**18 in the transaction's
///        outer value field) arrives as msg.value == 10**8, not 10**18.
///        virtualHbarReserve, realHbarReserve, the creation fee, and the
///        funding goal are therefore all in tinybars in this contract.
///      - The OUTER transaction's value field - what a caller building an
///        eth_sendTransaction/ethers call must put in {value: ...} - is
///        still the standard 18-decimal EVM convention (what script.js's
///        `feeWeibars = BigInt(hbar * 1e8) * 10n**10n` already produces
///        correctly for other transfers). Hedera only translates between
///        the two forms at that RPC boundary, not inside the EVM. So a
///        caller reading e.g. creationFeeTinybars() from this contract
///        must multiply by 10**10 before using it as a transaction's
///        value - that conversion is the caller's job, not this
///        contract's.
///      - Token amounts (the curve's own token reserves, balances,
///        getAmountOut results for token quantities) are in the token's
///        own 8 decimals, matching every ethers.parseUnits/formatUnits(_, 8)
///        call already in coin.js - this part was never in question.
///      Every function below that takes or returns an "amount" documents
///      which of these it's in.
///
/// 2. HTS TOKEN CREATION CONSTRAINTS - confirmed working, after several
///    failed iterations, in this project's own history:
///      - treasury MUST be address(this) (the contract itself), not
///        msg.sender or any externally-owned account. Setting treasury to
///        anything the contract can't itself authorize causes the HTS
///        precompile call to fail signature validation.
///      - tokenKeys MUST be an empty array - no admin key, no supply key.
///        This makes the token fully immutable post-creation, which is
///        fine for this design: the entire fixed supply mints to this
///        contract (as treasury) in one shot at create() time, and the
///        curve only ever moves already-minted tokens between this
///        contract and traders. No future minting is needed, so no supply
///        key is needed either.
///      - Do NOT use HTS's native custom-fee mechanism
///        (FixedFee/FractionalFee on createFungibleTokenWithCustomFees).
///        A fee collector other than the token's own treasury requires
///        that collector's explicit signature, which a contract-created
///        token can't provide - this reverts. All fees here are handled
///        as plain Solidity logic instead (see tradingFeeBps), never as
///        an HTS-native fee.
///      - Recipients must have the token ASSOCIATED (or an open
///        auto-association slot) before they can receive it via
///        transferToken/the ERC20 facade - this is an HTS account-level
///        rule, not something this contract can override on a user's
///        behalf. THE FRONTEND MUST GAIN A NEW STEP: before a wallet's
///        first buy of a given token, trigger that account's own
///        associate-token transaction (via the connected wallet, same way
///        HashPack already prompts for this in other dApps). Today's
///        frontend has no association handling at all - this is new
///        surface area, not a port of existing code.
///
/// ============================================================================
/// DELIBERATELY OUT OF SCOPE FOR v1 (do not build these here)
/// ============================================================================
///   - DEX-liquidity seeding at graduation (the reserved 200M tokens +
///     raised HBAR just sit in the contract post-graduation; a v2 project)
///   - Referrer / distributeRewards fields memejob has - unused
///     meaningfully by this app today (always passed as zero address), so
///     dropped rather than carried forward speculatively.
///   - Migrating existing tokens (WEEEB, Clown, etc.) from memejob - they
///     stay on memejob permanently; only new launches use this contract.
interface IOnycBondingCurve {

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @notice Per-token curve state, keyed by tokenAddress in memeTokens().
    /// Field names/shape deliberately mirror memejob's
    /// addressToMemeTokenMapping so coin.js's bonding-progress-bar code
    /// needs minimal changes when pointed at this contract instead.
    struct MemeToken {
        address tokenAddress;       // HTS token address; this contract is its treasury
        address creatorAddress;    // wallet that called create()
        uint256 virtualHbarReserve; // 8-decimal tinybars
        uint256 virtualTokenReserve; // 8-decimal token units
        uint256 realHbarReserve;    // 8-decimal tinybars actually raised
        uint256 tokensSold;         // 8-decimal token units, cumulative, informational
        bool graduated;             // true once realHbarReserve >= fundingGoal(); trading frozen
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    /// @notice Emitted once per successful create(). mirror-trades.js-style
    /// log scanning discovers new tokens the same way it already discovers
    /// buy/sell activity.
    event MemeCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol
    );

    /// @notice Same field shape as the TokensBought event api/award-points.js
    /// and coin.js already parse from memejob, so that parsing code is
    /// portable with just an ABI/address swap.
    event TokensBought(
        address indexed tokenAddress,
        address indexed buyer,
        uint256 amount,       // tokens received, 8 decimals
        uint256 totalPrice    // tinybars paid including fee, 8 decimals
    );

    event TokensSold(
        address indexed tokenAddress,
        address indexed seller,
        uint256 amount,       // tokens sold, 8 decimals
        uint256 totalPrice    // tinybars received net of fee, 8 decimals
    );

    /// @notice Emitted exactly once per token, the moment realHbarReserve
    /// first reaches fundingGoal(). Curve trading is frozen from this
    /// point on for that token (buy/sell must revert with
    /// TokenAlreadyGraduated). DEX-liquidity seeding using the reserved
    /// 200M supply + hbarRaised is explicitly a future feature, not part
    /// of this contract's responsibility.
    event Graduated(address indexed tokenAddress, uint256 hbarRaised);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error IncorrectCreationFee(uint256 expected, uint256 sent);
    error TokenNotFound(address tokenAddress);
    error TokenAlreadyGraduated(address tokenAddress);
    error BuySlippageExceeded(uint256 minTokensOut, uint256 actualTokensOut);
    error SellSlippageExceeded(uint256 minHbarOut, uint256 actualHbarOut);
    error ZeroAmount();
    error HtsTokenCreationFailed(int64 responseCode);
    error HtsTransferFailed(int64 responseCode);

    // ------------------------------------------------------------------
    // Write functions
    // ------------------------------------------------------------------

    /// @notice Creates a new HTS token and its bonding curve in a single
    /// transaction. Requires exactly creationFeeTinybars() as
    /// msg.value (8-decimal tinybars), forwarded to treasury atomically -
    /// no separate follow-up transfer, no exchange-rate-precompile
    /// dependency, no retry loop on the frontend.
    /// @param name Token display name
    /// @param symbol Token symbol
    /// @param memo IPFS URI (or short plain string) describing the token -
    ///        stored as the HTS token's own on-chain memo field, same
    ///        convention as today. Callers must keep this within HTS's
    ///        100-byte memo limit; implementation should revert clearly if not.
    /// @return tokenAddress The new HTS token's EVM address
    function create(
        string calldata name,
        string calldata symbol,
        string calldata memo
    ) external payable returns (address tokenAddress);

    /// @notice Buys tokenAddress tokens with attached HBAR (msg.value, 18-
    /// decimal tinybars). Reverts with BuySlippageExceeded if the tokens
    /// received would be less than minTokensOut (8-decimal token units),
    /// or TokenAlreadyGraduated if the curve is frozen.
    function buy(
        address tokenAddress,
        uint256 minTokensOut
    ) external payable returns (uint256 tokensOut);

    /// @notice Sells tokenAmount (8-decimal token units) of tokenAddress
    /// back to the curve for HBAR. The caller's account must already have
    /// tokenAddress associated (see the association note above) and must
    /// have approved/transferred correctly per HTS's ERC20 facade rules.
    /// Reverts with SellSlippageExceeded if the HBAR received (8-decimal
    /// tinybars) would be less than minHbarOut. Unlike memejob's sellJob,
    /// this has a slippage parameter at all - memejob's doesn't, which is
    /// the actual reason this app's slippage UI buttons have never been
    /// wireable on the sell side.
    function sell(
        address tokenAddress,
        uint256 tokenAmount,
        uint256 minHbarOut
    ) external returns (uint256 hbarOut);

    // ------------------------------------------------------------------
    // View functions - pricing
    // ------------------------------------------------------------------

    /// @notice Quotes a buy or sell without executing it. Matches memejob's
    /// existing getAmountOut(token, amount, txType) call shape exactly -
    /// amount is ALWAYS a token quantity (8 decimals) in both directions:
    /// txType 0 (buy) returns the HBAR cost (8-decimal tinybars) for that
    /// many tokens; txType 1 (sell) returns the HBAR proceeds for selling
    /// that many tokens. Kept for drop-in compatibility with coin.js's
    /// existing price/market-cap display code.
    function getAmountOut(
        address tokenAddress,
        uint256 amount,
        uint8 txType
    ) external view returns (uint256);

    /// @notice Direct "I have this much HBAR, how many tokens do I get"
    /// quote - the inverse direction getAmountOut doesn't provide, which
    /// today requires coin.js's client-side binary search
    /// (findTokenAmountForHbarBudget) against memejob. Since the constant-
    /// product formula is cleanly invertible, this contract can answer it
    /// directly, letting that binary search be deleted entirely once the
    /// frontend points at this contract.
    /// @param hbarAmountIn 8-decimal tinybars (before fee)
    /// @return tokensOut 8-decimal token units
    function previewBuy(
        address tokenAddress,
        uint256 hbarAmountIn
    ) external view returns (uint256 tokensOut);

    /// @param tokenAmountIn 8-decimal token units
    /// @return hbarOut 8-decimal tinybars (after fee)
    function previewSell(
        address tokenAddress,
        uint256 tokenAmountIn
    ) external view returns (uint256 hbarOut);

    // ------------------------------------------------------------------
    // View functions - config & state
    // ------------------------------------------------------------------

    /// @notice Flat HBAR fee (8-decimal tinybars) required to create a
    /// token. A plain constant set at deploy time - no precompile lookup,
    /// no hourly-boundary flakiness.
    function creationFeeTinybars() external view returns (uint256);

    /// @notice Trading fee in basis points (e.g. 100 = 1%), taken on every
    /// buy and sell.
    function tradingFeeBps() external view returns (uint16);

    /// @notice Real HBAR (8-decimal tinybars) a token's realHbarReserve
    /// must reach to graduate.
    function fundingGoal() external view returns (uint256);

    /// @notice Full curve state for a token - same fields coin.js's
    /// bonding-progress bar already reads from memejob's
    /// addressToMemeTokenMapping, just via this contract instead.
    function memeTokens(address tokenAddress) external view returns (MemeToken memory);
}
