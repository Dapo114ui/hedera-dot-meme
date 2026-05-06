const solc = require('solc');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
    console.log("Compiling MemeFactoryHTSSimple.sol...");
    const contractPath = path.resolve(__dirname, 'contracts', 'MemeFactoryHTSSimple.sol');
    const source = fs.readFileSync(contractPath, 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'MemeFactoryHTSSimple.sol': {
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

    const contract = output.contracts['MemeFactoryHTSSimple.sol']['MemeFactoryHTSSimple'];
    const abi = contract.abi;
    const bytecode = contract.evm.bytecode.object;
    
    fs.writeFileSync('MemeFactoryHTSSimple_output.json', JSON.stringify({ abi, bytecode }, null, 2));
    
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log("Deploying MemeFactoryHTSSimple...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    
    const deployedContract = await factory.deploy();
    await deployedContract.waitForDeployment();
    
    const address = await deployedContract.getAddress();
    console.log("Contract Deployed to:", address);
    
    console.log("Funding contract with 50 HBAR for precompile fees...");
    const tx = await wallet.sendTransaction({
        to: address,
        value: ethers.parseEther("50.0")
    });
    await tx.wait();
    console.log("Contract successfully funded!");
}

main().catch(console.error);
