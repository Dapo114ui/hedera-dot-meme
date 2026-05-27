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
}

contract MemeFactory {
    address constant PRECOMPILE_ADDRESS = address(0x167);
    
    address public treasury;

    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);
    event DebugResponse(int64 responseCode);

    constructor(address _treasury) {
        treasury = _treasury;
    }

    function createMemeToken(string memory name, string memory symbol, int64 initialSupply, string memory imageUrl) external returns (address) {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        
        keys[0] = IHederaTokenService.TokenKey({
            keyType: 1, // ADMIN
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: true,
                contractId: address(0),
                ed25519: new bytes(0),
                ECDSA_secp256k1: new bytes(0),
                delegatableContractId: address(0)
            })
        });

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry({
            second: 0,
            autoRenewAccount: msg.sender,
            autoRenewPeriod: 7776000 // 90 days
        });

        // Set treasury directly to msg.sender to receive 100% of supply
        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: msg.sender,
            memo: imageUrl,
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: expiry
        });

        // 1% Fractional fee to treasury EVM address
        IHederaTokenService.FractionalFee[] memory fractionalFees = new IHederaTokenService.FractionalFee[](1);
        fractionalFees[0] = IHederaTokenService.FractionalFee({
            numerator: 1,
            denominator: 100,
            minimumAmount: 0,
            maximumAmount: 0,
            netOfTransfers: false,
            feeCollector: treasury
        });

        IHederaTokenService.FixedFee[] memory fixedFees = new IHederaTokenService.FixedFee[](0);

        // HTS uses int64 for balances. 8 decimals is safe for 1B tokens.
        int64 totalTokens = initialSupply * int64(10**8);

        (int64 responseCode, address tokenAddress) = IHederaTokenService(PRECOMPILE_ADDRESS).createFungibleTokenWithCustomFees(
            token,
            totalTokens,
            8,
            fixedFees,
            fractionalFees
        );

        emit DebugResponse(responseCode);
        require(responseCode == 22, "HTS Precompile Failed"); // 22 is SUCCESS

        emit MemeLaunched(msg.sender, tokenAddress, name, symbol, imageUrl);
        
        return tokenAddress;
    }
}
