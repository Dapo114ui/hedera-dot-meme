const { ethers } = require('ethers');

async function main() {
    console.log("Connecting to Hedera Testnet RPC...");
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const ABI = [
        "function launchFee() view returns (uint256)",
        "function owner() view returns (address)"
    ];
    
    const contractAddress = "0x73209174ce10c4b2a6dad147cac3f7e1d3d5ed50";
    const contract = new ethers.Contract(contractAddress, ABI, provider);
    
    try {
        const fee = await contract.launchFee();
        console.log("Contract launchFee is:", fee.toString());
        console.log("In ETH:", ethers.formatEther(fee));
        
        const owner = await contract.owner();
        console.log("Contract owner is:", owner);
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
