require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

// Treasury address pulled from environment variables
const TREASURY_ID = process.env.TREASURY_ACCOUNT_ID;
if (!TREASURY_ID) {
    console.error("Error: TREASURY_ACCOUNT_ID is not defined in .env");
    process.exit(1);
}

// Convert to EVM address for contract calls
const TREASURY_ADDRESS = TREASURY_ID.startsWith('0.0.') 
    ? `0x0000000000000000000000000000000000${parseInt(TREASURY_ID.split('.')[2]).toString(16).padStart(6, '0')}`
    : TREASURY_ID;

async function main() {
    // 1. Setup Provider & Signer
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    if (!PRIVATE_KEY || PRIVATE_KEY === 'PASTE_YOUR_NEW_PRIVATE_KEY_HERE') {
        console.error("Error: TREASURY_PRIVATE_KEY is not defined or is a placeholder in .env");
        process.exit(1);
    }
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying from address:", wallet.address);

    // 2. Load ABI and Bytecode from the compiled output
    const contractData = JSON.parse(fs.readFileSync('MemeFactoryV3_output.json', 'utf8'));
    const abi = contractData.abi;
    const bytecode = contractData.bytecode; 

    if (!bytecode) {
        console.error("Error: Bytecode not found in MemeFactoryV3_output.json");
        return;
    }

    console.log("Deploying MemeFactoryV3 with treasury:", TREASURY_ADDRESS);

    // 3. Create Contract Factory and Deploy
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    try {
        const contract = await factory.deploy(TREASURY_ADDRESS);
        await contract.waitForDeployment();
        
        const deployedAddress = await contract.getAddress();
        console.log("------------------------------------------");
        console.log("MemeFactoryV3 Deployed Successfully!");
        console.log("Contract Address:", deployedAddress);
        console.log("------------------------------------------");
        console.log("Next Step: Update CONTRACT_ADDRESS_V2 in script.js with this new address.");
    } catch (error) {
        console.error("Deployment failed:", error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
