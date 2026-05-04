require('dotenv').config();
const { 
    Client, 
    AccountId, 
    PrivateKey, 
    AccountUpdateTransaction 
} = require("@hashgraph/sdk");

async function main() {
    // 1. Load credentials from environment
    const treasuryIdStr = process.env.TREASURY_ACCOUNT_ID || "0.0.8809059";
    const treasuryKeyStr = process.env.TREASURY_PRIVATE_KEY;

    if (!treasuryKeyStr || treasuryKeyStr === "PASTE_YOUR_NEW_PRIVATE_KEY_HERE") {
        console.error("Error: TREASURY_PRIVATE_KEY is not set correctly in .env");
        process.exit(1);
    }

    const treasuryId = AccountId.fromString(treasuryIdStr);
    const treasuryKey = PrivateKey.fromStringECDSA(treasuryKeyStr);

    // 2. Setup Hedera Client (Testnet)
    const client = Client.forTestnet();
    client.setOperator(treasuryId, treasuryKey);

    console.log(`Configuring account ${treasuryIdStr} for unlimited auto-associations...`);

    try {
        // 3. Create and execute the AccountUpdateTransaction
        const transaction = new AccountUpdateTransaction()
            .setAccountId(treasuryId)
            .setMaxAutomaticTokenAssociations(-1) // Set to -1 for unlimited
            .freezeWith(client);

        const signTx = await transaction.sign(treasuryKey);
        const txResponse = await signTx.execute(client);
        
        // 4. Get receipt to confirm success
        const receipt = await txResponse.getReceipt(client);
        console.log("--------------------------------------------------");
        console.log("SUCCESS!");
        console.log(`Status: ${receipt.status.toString()}`);
        console.log(`Account ${treasuryIdStr} can now automatically accept token fees.`);
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error("Failed to configure account:", error);
    } finally {
        client.close();
    }
}

main();
