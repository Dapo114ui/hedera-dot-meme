const fs = require('fs');
const solc = require('solc');

function compile() {
    const sourceCode = fs.readFileSync('contracts/MemeFactoryV2.sol', 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'MemeFactoryV2.sol': {
                content: sourceCode,
            },
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['*'],
                },
            },
            evmVersion: "paris"
        },
    };

    console.log("Compiling MemeFactoryV2.sol...");
    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
        output.errors.forEach((err) => {
            console.error(err.formattedMessage);
        });
        const hasErrors = output.errors.some(e => e.severity === 'error');
        if (hasErrors) return;
    }

    const contract = output.contracts['MemeFactoryV2.sol']['MemeFactory'];
    
    const bytecode = contract.evm.bytecode.object;
    const abi = contract.abi;

    fs.writeFileSync('MemeFactoryV2_output.json', JSON.stringify({ abi, bytecode }, null, 2));
    console.log("Compiled successfully to MemeFactoryV2_output.json");
}

compile();
