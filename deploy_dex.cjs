require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

const TREASURY_ID = process.env.TREASURY_ACCOUNT_ID;
if (!TREASURY_ID) {
    console.error("Error: TREASURY_ACCOUNT_ID is not defined in .env");
    process.exit(1);
}

// We use the wallet's ECDSA alias address directly instead of the Hedera long-zero mapped address
// to ensure the EVM can route HBAR fee transfers smoothly.
async function main() {
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    if (!PRIVATE_KEY || PRIVATE_KEY === 'PASTE_YOUR_NEW_PRIVATE_KEY_HERE') {
        console.error("Error: TREASURY_PRIVATE_KEY is not defined or is a placeholder in .env");
        process.exit(1);
    }
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying from address:", wallet.address);

    const contractData = JSON.parse(fs.readFileSync('MemeDex_output.json', 'utf8'));
    
    const dexData = contractData.contracts['MemeDex.sol']['MemeDex'];
    const factoryData = contractData.contracts['MemeFactoryV4.sol']['MemeFactoryV4'];

    const TREASURY_ADDRESS = wallet.address;
    
    console.log("Deploying MemeDex with treasury alias address:", TREASURY_ADDRESS);
    const dexFactory = new ethers.ContractFactory(dexData.abi, dexData.evm.bytecode.object, wallet);
    
    try {
        const dexContract = await dexFactory.deploy(TREASURY_ADDRESS, { gasLimit: 2000000 });
        await dexContract.waitForDeployment();
        const dexAddress = await dexContract.getAddress();
        console.log("MemeDex Deployed at:", dexAddress);

        console.log("Deploying MemeFactoryV4...");
        const factoryFactory = new ethers.ContractFactory(factoryData.abi, factoryData.evm.bytecode.object, wallet);
        const factoryContract = await factoryFactory.deploy(TREASURY_ADDRESS, dexAddress, { gasLimit: 3000000 });
        await factoryContract.waitForDeployment();
        const factoryAddress = await factoryContract.getAddress();
        console.log("MemeFactoryV4 Deployed at:", factoryAddress);

        console.log("Wiring Dex to Factory...");
        const tx = await dexContract.setFactory(factoryAddress, { gasLimit: 500000 });
        await tx.wait();
        console.log("Dex factory set to:", factoryAddress);

        console.log("------------------------------------------");
        console.log("Deployment Successful!");
        console.log("DEX_ADDRESS:", dexAddress);
        console.log("FACTORY_ADDRESS:", factoryAddress);
        console.log("------------------------------------------");
        console.log("Next Step: Update script.js and coin.js with these new addresses.");

        // Save output
        fs.writeFileSync('contract_info.json', JSON.stringify({
            DEX_ADDRESS: dexAddress,
            FACTORY_ADDRESS: factoryAddress
        }, null, 2));

    } catch (error) {
        console.error("Deployment failed:", error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
