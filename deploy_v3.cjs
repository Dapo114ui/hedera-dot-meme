const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

async function main() {
    const output = JSON.parse(fs.readFileSync('MemeFactoryV3_output.json', 'utf8'));
    const factoryData = output['MemeFactoryV3'];
    const bytecode = factoryData.evm.bytecode.object;
    const abi = factoryData.abi;

    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const wallet = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, provider);

    console.log(`Deploying from address: ${wallet.address}`);

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    // TREASURY ADDRESS FOR V3
    const treasuryAddress = "0x9391D8058F85be7909972a57deF213387b50Bb11"; // The user's platform treasury address

    console.log(`Deploying MemeFactoryV3 with platform treasury: ${treasuryAddress}`);
    const contract = await factory.deploy(treasuryAddress, { gasLimit: 3000000 });
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("------------------------------------------");
    console.log("MemeFactoryV3 Deployed Successfully!");
    console.log(`Contract Address: ${address}`);
    console.log("------------------------------------------");
    console.log("Next Step: Update CONTRACT_ADDRESS_V3 in script.js with this new address.");
}

main().catch(console.error);
