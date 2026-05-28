const solc = require('solc');
const fs = require('fs');
const path = require('path');

function compile() {
    console.log("Compiling MemeFactoryV3.sol...");
    const contractPath = path.resolve(__dirname, 'contracts', 'MemeFactoryV3.sol');
    const source = fs.readFileSync(contractPath, 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'MemeFactoryV3.sol': {
                content: source,
            },
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['*'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
        output.errors.forEach((err) => {
            console.error(err.formattedMessage);
        });
        const hasErrors = output.errors.some(e => e.severity === 'error');
        if (hasErrors) process.exit(1);
    }

    const contracts = output.contracts['MemeFactoryV3.sol'];
    fs.writeFileSync('MemeFactoryV3_output.json', JSON.stringify(contracts, null, 2));
    console.log("Compiled successfully to MemeFactoryV3_output.json");
}

compile();
