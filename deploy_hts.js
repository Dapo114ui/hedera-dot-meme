const { ethers } = require('ethers');
const fs = require('fs');

// Treasury address provided by the user
const TREASURY_ADDRESS = "0x9391d8058f85be7909972a57def213387b50bb11"; // 0.0.8809059

async function main() {
    // 1. Setup Provider & Signer
    // WARNING: Do not store your private key in code files!
    const PRIVATE_KEY = "PASTE_PRIVATE_KEY_HERE"; 
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying from address:", wallet.address);

    // 2. Load ABI and Bytecode from the compiled output
    const contractData = JSON.parse(fs.readFileSync('MemeFactoryHTS_output.json', 'utf8'));
    const abi = contractData.abi;
    const bytecode = contractData.bytecode; 

    if (!bytecode) {
        console.error("Error: Bytecode not found in MemeFactoryHTS_output.json");
        return;
    }

    console.log("Deploying MemeFactoryHTS with platform treasury:", TREASURY_ADDRESS);

    // 3. Create Contract Factory and Deploy
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    try {
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        
        const deployedAddress = await contract.getAddress();
        console.log("------------------------------------------");
        console.log("MemeFactoryHTS Deployed Successfully!");
        console.log("Contract Address:", deployedAddress);
        
        // Fund the contract with some HBAR to cover HTS fees initially
        console.log("Funding contract with 100 HBAR...");
        const tx = await wallet.sendTransaction({
            to: deployedAddress,
            value: ethers.parseUnits("100", 8) // 100 HBAR
        });
        await tx.wait();
        console.log("Contract funded!");
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
