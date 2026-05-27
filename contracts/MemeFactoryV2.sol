// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IHederaTokenService {
    struct TokenKey {
        uint256 keyType;
        KeyValue key;
    }

    struct KeyValue {
        bool inheritAccountKey;
        address contractId;
        bytes ed25519;
        bytes ECDSA_secp256k1;
        address delegatableContractId;
    }

    struct Expiry {
        uint32 second;
        address autoRenewAccount;
        uint32 autoRenewPeriod;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType;
        uint32 maxSupply;
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    struct FixedFee {
        uint32 amount;
        address tokenId;
        bool useHbarsForPayment;
        bool useCurrentTokenForPayment;
        address feeCollector;
    }

    struct FractionalFee {
        uint32 numerator;
        uint32 denominator;
        uint32 minimumAmount;
        uint32 maximumAmount;
        bool netOfTransfers;
        address feeCollector;
    }

    function createFungibleTokenWithCustomFees(
        HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals,
        FixedFee[] memory fixedFees,
        FractionalFee[] memory fractionalFees
    ) external payable returns (int64 responseCode, address tokenAddress);

    function createFungibleToken(
        HederaToken memory token,
        uint256 initialTotalSupply,
        uint256 decimals
    ) external payable returns (int64 responseCode, address tokenAddress);
    function transferToken(
        address token,
        address sender,
        address recipient,
        int64 amount
    ) external returns (int64 responseCode);
}

contract MemeFactory {
    address constant PRECOMPILE_ADDRESS = address(0x167);
    
    address public treasury;

    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);
    event DebugResponse(int64 responseCode);

    constructor(address _treasury) {
        treasury = _treasury;
    }

    // REQUIRED for HTS Precompile to refund excess HBAR
    receive() external payable {}
    fallback() external payable {}

    function createMemeToken(string memory name, string memory symbol, int64 initialSupply, string memory imageUrl) external payable returns (address) {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](0);

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry({
            second: 0,
            autoRenewAccount: address(0),
            autoRenewPeriod: 7776000 // 90 days
        });

        // Set treasury to THIS contract to bypass signature requirements from EVM caller
        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: imageUrl,
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: expiry
        });

        // HTS allows uint256 for createFungibleToken.
        uint256 totalTokens = uint256(uint64(initialSupply)) * (10**8);

        (int64 responseCode, address tokenAddress) = IHederaTokenService(PRECOMPILE_ADDRESS).createFungibleToken{value: msg.value}(
            token,
            totalTokens,
            8
        );

        emit DebugResponse(responseCode);
        require(responseCode == 22, "HTS Precompile Failed"); // 22 is SUCCESS

        // Transfer all minted tokens from this contract to the creator
        // REQUIRES the creator to have open auto-association slots!
        int64 transferResponse = IHederaTokenService(PRECOMPILE_ADDRESS).transferToken(
            tokenAddress,
            address(this),
            msg.sender,
            int64(int256(totalTokens))
        );
        require(transferResponse == 22, "Token Transfer Failed (No Auto-Association Slots?)");

        emit MemeLaunched(msg.sender, tokenAddress, name, symbol, imageUrl);
        
        // Send the remaining HBAR fee (after HTS precompile costs) to the platform treasury
        uint256 excess = address(this).balance;
        if (excess > 0 && treasury != address(0)) {
            (bool success, ) = treasury.call{value: excess}("");
            require(success, "Treasury transfer failed");
        }

        return tokenAddress;
    }
}
