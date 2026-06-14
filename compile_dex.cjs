const fs = require('fs');
const solc = require('solc');

const factorySource = fs.readFileSync('contracts/MemeFactoryV4.sol', 'utf8');
const dexSource = fs.readFileSync('contracts/MemeDex.sol', 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'MemeFactoryV4.sol': {
            content: factorySource
        },
        'MemeDex.sol': {
            content: dexSource
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['*']
            }
        }
    }
};

console.log("Compiling MemeFactoryV4.sol and MemeDex.sol...");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    let hasErrors = false;
    output.errors.forEach((err) => {
        console.error(err.formattedMessage);
        if (err.severity === 'error') hasErrors = true;
    });
    if (hasErrors) process.exit(1);
}

fs.writeFileSync('MemeDex_output.json', JSON.stringify(output, null, 2));
console.log("Compiled successfully to MemeDex_output.json");
