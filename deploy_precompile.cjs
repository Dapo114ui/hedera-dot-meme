require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    if (!PRIVATE_KEY || PRIVATE_KEY === 'PASTE_YOUR_NEW_PRIVATE_KEY_HERE') {
        console.error("Error: TREASURY_PRIVATE_KEY is not defined.");
        process.exit(1);
    }
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying from address:", wallet.address);

    const contractData = JSON.parse(fs.readFileSync('MemeFactoryHTSPrecompile_output.json', 'utf8'));
    const abi = contractData.abi;
    const bytecode = contractData.bytecode; 

    console.log("Deploying MemeFactoryHTSPrecompile...");

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    try {
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        
        const deployedAddress = await contract.getAddress();
        console.log("------------------------------------------");
        console.log("MemeFactoryHTSPrecompile Deployed Successfully!");
        console.log("Contract Address:", deployedAddress);
        console.log("------------------------------------------");
    } catch (error) {
        console.error("Deployment failed:", error);
    }
}

main().catch(console.error);
