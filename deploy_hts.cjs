require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying from address:", wallet.address);

    const contractData = JSON.parse(fs.readFileSync('MemeFactoryHTS_output.json', 'utf8'));
    const abi = contractData.abi;
    const bytecode = contractData.bytecode; 

    console.log("Deploying MemeFactoryHTS...");

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    
    const deployedAddress = await contract.getAddress();
    console.log("MemeFactoryHTS Deployed Successfully!");
    console.log("Contract Address:", deployedAddress);
    
    console.log("Funding contract with 50 HBAR for precompile fees...");
    const tx = await wallet.sendTransaction({
        to: deployedAddress,
        value: ethers.parseEther("50.0")
    });
    await tx.wait();
    console.log("Contract successfully funded!");
}

main().catch(console.error);
