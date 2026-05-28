const fs = require('fs');
const solc = require('solc');

const sourceCode = fs.readFileSync('contracts/MemeFactoryV3.sol', 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'MemeFactoryV3.sol': {
            content: sourceCode
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

console.log("Compiling MemeFactoryV3.sol...");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    let hasErrors = false;
    output.errors.forEach((err) => {
        console.error(err.formattedMessage);
        if (err.severity === 'error') hasErrors = true;
    });
    if (hasErrors) process.exit(1);
}

fs.writeFileSync('MemeFactoryV3_output.json', JSON.stringify(output, null, 2));
console.log("Compiled successfully to MemeFactoryV3_output.json");
