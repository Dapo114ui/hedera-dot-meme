// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @dev Simple Hedera Meme Token Factory
 * This contract creates new meme tokens on Hedera using the HTS Precompile.
 * Note: This is a simplified version for demonstration.
 */

interface IHederaTokenService {
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

    function createFungibleToken(
        HederaToken memory token,
        uint256 initialSupply,
        uint256 decimals
    ) external payable returns (int responseCode, address tokenAddress);
}

contract MemeFactory {
    address constant HTS_PRECOMPILE = address(0x167);
    address public owner;
    uint256 public launchFee = 5 ether; // 5 HBAR

    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol);

    constructor() {
        owner = msg.sender;
    }

    function createMemeToken(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) external payable returns (address) {
        require(msg.value >= launchFee, "Insufficient launch fee");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](0);
        
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.treasury = msg.sender;
        token.memo = "Created via Hedera.Meme";
        token.tokenSupplyType = false; // Finite
        token.maxSupply = uint32(initialSupply);
        token.freezeDefault = false;
        token.tokenKeys = keys;
        token.expiry = IHederaTokenService.Expiry(0, address(0), 7000000);

        (int responseCode, address tokenAddress) = IHederaTokenService(HTS_PRECOMPILE).createFungibleToken{value: msg.value}(
            token,
            initialSupply,
            8 // Decimals
        );

        require(responseCode == 22, "Token creation failed"); // 22 is SUCCESS for HTS

        emit MemeLaunched(msg.sender, tokenAddress, name, symbol);
        
        // Refund excess HBAR to creator if any (HTS fee is dynamic but usually < 5 HBAR)
        // But here we keep the 5 HBAR fee as the platform revenue
        
        return tokenAddress;
    }

    function withdraw() external {
        require(msg.sender == owner, "Only owner");
        payable(owner).transfer(address(this).balance);
    }
    
    receive() external payable {}
}
