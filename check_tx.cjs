const axios = require('axios');

async function main() {
    const txHash = '0xcca37495216759ab9ed8af7fabd22b813bc56b36e9f6357deb6c3a50e7c22241';
    
    try {
        console.log("Fetching transaction from Mirror Node...");
        const response = await axios.get(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${txHash}`, { validateStatus: () => true });
        console.log("Contracts/results status:", response.status);
        console.log("Result:", response.data.result);
        console.log("Error Message:", response.data.error_message);
        
        // Let's also fetch the parent transaction to see standard Hedera status
        const txResponse = await axios.get(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${txHash}`, { validateStatus: () => true });
        console.log("Transactions status:", txResponse.status);
        if (txResponse.data.transactions && txResponse.data.transactions.length > 0) {
            console.log("Hedera Status:", txResponse.data.transactions[0].result);
            console.log("Name:", txResponse.data.transactions[0].name);
        } else {
            console.log("No transactions found.");
        }
        
    } catch (e) {
        console.error(e.message);
    }
}

main();
