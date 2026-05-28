require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, provider);

    const output = JSON.parse(fs.readFileSync('MemeFactoryV3_output.json', 'utf8'));
    const contractFile = output.contracts['MemeFactoryV3.sol']['MemeFactoryV3'];

    const abi = contractFile.abi;
    const bytecode = contractFile.evm.bytecode.object;

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const treasuryAddress = "0x9391D8058F85be7909972a57deF213387b50Bb11"; // Platform Treasury

    console.log(`Deploying from address: ${wallet.address}`);
    console.log(`Deploying MemeFactoryV3 with platform treasury: ${treasuryAddress}`);

    const contract = await factory.deploy(treasuryAddress, { gasLimit: 4000000 });
    await contract.waitForDeployment();

    console.log('------------------------------------------');
    console.log('MemeFactoryV3 Deployed Successfully!');
    console.log(`Contract Address: ${contract.target}`);
    console.log('------------------------------------------');
    console.log('Next Step: Update CONTRACT_ADDRESS_V3 in script.js with this new address.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
