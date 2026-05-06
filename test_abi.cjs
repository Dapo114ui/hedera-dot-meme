const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    
    const PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000167";
    
    // We only need the input types to see if it reverts with NO DATA or returns a responseCode
    // We use dummy struct for HederaToken
    const abis = [
        "function createFungibleToken(tuple(string name, string symbol, address treasury, string memo, bool tokenSupplyType, uint32 maxSupply, bool freezeDefault, tuple(uint256 keyType, tuple(bool inheritAccountKey, address contractId, bytes ed25519, bytes ECDSA_secp256k1, address delegatableContractId) key)[] tokenKeys, tuple(uint32 second, address autoRenewAccount, uint32 autoRenewPeriod) expiry) token, int64 initialTotalSupply, int32 decimals) returns (int64 responseCode, address tokenAddress)",
        "function createFungibleToken(tuple(string name, string symbol, address treasury, string memo, bool tokenSupplyType, uint32 maxSupply, bool freezeDefault, tuple(uint256 keyType, tuple(bool inheritAccountKey, address contractId, bytes ed25519, bytes ECDSA_secp256k1, address delegatableContractId) key)[] tokenKeys, tuple(uint32 second, address autoRenewAccount, uint32 autoRenewPeriod) expiry) token, uint64 initialTotalSupply, uint32 decimals) returns (int64 responseCode, address tokenAddress)",
        "function createFungibleToken(tuple(string name, string symbol, address treasury, string memo, bool tokenSupplyType, uint32 maxSupply, bool freezeDefault, tuple(uint256 keyType, tuple(bool inheritAccountKey, address contractId, bytes ed25519, bytes ECDSA_secp256k1, address delegatableContractId) key)[] tokenKeys, tuple(uint32 second, address autoRenewAccount, uint32 autoRenewPeriod) expiry) token, uint256 initialTotalSupply, uint256 decimals) returns (int64 responseCode, address tokenAddress)",
        "function createFungibleToken(tuple(string name, string symbol, address treasury, string memo, bool tokenSupplyType, uint32 maxSupply, bool freezeDefault, tuple(uint256 keyType, tuple(bool inheritAccountKey, address contractId, bytes ed25519, bytes ECDSA_secp256k1, address delegatableContractId) key)[] tokenKeys, tuple(uint32 second, address autoRenewAccount, uint32 autoRenewPeriod) expiry) token, uint initialTotalSupply, uint decimals) payable returns (int64 responseCode, address tokenAddress)"
    ];

    const token = {
        name: "My Meme",
        symbol: "MEME",
        treasury: "0x1D19c97e7DCF1cF538030a9b4BAc4Ce1B6A27378",
        memo: "ipfs://test",
        tokenSupplyType: false,
        maxSupply: 0,
        freezeDefault: false,
        tokenKeys: [],
        expiry: {
            second: 0,
            autoRenewAccount: "0x0000000000000000000000000000000000000000",
            autoRenewPeriod: 7776000
        }
    };

    for (let i = 0; i < abis.length; i++) {
        console.log(`\nTesting ABI ${i}...`);
        try {
            const contract = new ethers.Contract(PRECOMPILE_ADDRESS, [abis[i]], provider);
            const result = await contract.createFungibleToken.staticCall(token, 100000000n, 8);
            console.log(`ABI ${i} SUCCESS! ResponseCode: ${result[0]}, TokenAddress: ${result[1]}`);
        } catch (e) {
            console.log(`ABI ${i} FAILED: ${e.shortMessage || e.message}`);
        }
    }
}

main().catch(console.error);
