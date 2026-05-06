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

    function createFungibleToken(
        HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64 responseCode, address tokenAddress);
}

contract MemeFactoryHTSDelegate {
    address constant PRECOMPILE_ADDRESS = address(0x167);
    
    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);
    event DebugResponse(int64 responseCode);

    function createMemeToken(
        string memory name, 
        string memory symbol, 
        int64 initialSupply, 
        string memory imageUrl
    ) external returns (address) {
        
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

        bytes memory callData = abi.encodeWithSelector(
            IHederaTokenService.createFungibleToken.selector,
            token, initialSupply, int32(8)
        );
        
        (bool success, bytes memory result) = PRECOMPILE_ADDRESS.delegatecall(callData);
        require(success, "Delegatecall to HTS failed");
        
        (int64 responseCode, address tokenAddress) = abi.decode(result, (int64, address));
        emit DebugResponse(responseCode);
        require(responseCode == 22, "HTS Precompile Response Failed"); // 22 is SUCCESS

        emit MemeLaunched(msg.sender, tokenAddress, name, symbol, imageUrl);
        
        return tokenAddress;
    }
}
