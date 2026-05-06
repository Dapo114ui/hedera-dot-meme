require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
    const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const contractAddress = "0x1D19c97e7DCF1cF538030a9b4BAc4Ce1B6A27378";
    
    console.log("Sending 50 HBAR to", contractAddress);
    
    const tx = await wallet.sendTransaction({
        to: contractAddress,
        value: ethers.parseEther("50.0")
    });
    
    console.log("Transaction Hash:", tx.hash);
    await tx.wait();
    console.log("Funding successful! Contract now has HBAR for precompile fees.");
}

main().catch(console.error);
