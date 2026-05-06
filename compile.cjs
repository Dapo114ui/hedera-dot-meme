const solc = require('solc');
const fs = require('fs');
const path = require('path');

const contractPath = path.resolve(__dirname, 'contracts', 'MemeFactoryHTS.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'MemeFactoryHTS.sol': {
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
        },
        viaIR: true
    }
};

console.log("Compiling MemeFactoryHTS.sol...");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    output.errors.forEach(err => {
        console.error(err.formattedMessage);
    });
    if (output.errors.some(err => err.severity === 'error')) {
        process.exit(1);
    }
}

const contract = output.contracts['MemeFactoryHTS.sol']['MemeFactoryHTS'];
const abi = contract.abi;
const bytecode = contract.evm.bytecode.object;

fs.writeFileSync('MemeFactoryHTS_output.json', JSON.stringify({ abi, bytecode }, null, 2));
console.log("Compilation successful! ABI and Bytecode saved to MemeFactoryHTS_output.json");
