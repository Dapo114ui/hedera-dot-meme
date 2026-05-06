const solc = require('solc');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
    console.log("Compiling MemeFactoryHTSDelegate.sol...");
    const contractPath = path.resolve(__dirname, 'contracts', 'MemeFactoryHTSDelegate.sol');
    const source = fs.readFileSync(contractPath, 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'MemeFactoryHTSDelegate.sol': {
                content: source
            }
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode']
                }
            },
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
        output.errors.forEach(err => console.error(err.formattedMessage));
        if (output.errors.some(err => err.severity === 'error')) process.exit(1);
    }

    const contract = output.contracts['MemeFactoryHTSDelegate.sol']['MemeFactoryHTSDelegate'];
    const abi = contract.abi;
    const bytecode = contract.evm.bytecode.object;
    
    fs.writeFileSync('MemeFactoryHTSDelegate_output.json', JSON.stringify({ abi, bytecode }, null, 2));
    
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying MemeFactoryHTSDelegate...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    const deployedContract = await factory.deploy();
    await deployedContract.waitForDeployment();
    
    console.log("Contract Deployed to:", await deployedContract.getAddress());
}

main().catch(console.error);
