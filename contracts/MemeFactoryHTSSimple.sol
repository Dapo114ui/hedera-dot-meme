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

contract MemeFactoryHTSSimple {
    address constant PRECOMPILE_ADDRESS = address(0x167);
    
    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);

    function createMemeToken(
        string memory name, 
        string memory symbol, 
        int64 initialSupply, 
        string memory imageUrl
    ) external returns (address) {
        
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
            memo: imageUrl,
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: expiry
        });

        // Forward 20 HBAR from the contract's balance to pay the HTS fee!
        // This prevents the precompile from trying to implicitly charge the user (HashPack).
        (int64 responseCode, address tokenAddress) = IHederaTokenService(PRECOMPILE_ADDRESS).createFungibleToken{value: 20 ether}(
            token,
            initialSupply,
            8 
        );

        require(responseCode == 22, "HTS Precompile Failed"); 

        emit MemeLaunched(msg.sender, tokenAddress, name, symbol, imageUrl);
        
        return tokenAddress;
    }

    receive() external payable {}
}
