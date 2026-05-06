const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    const contractAddress = "0x73209174ce10c4b2a6dad147cac3f7e1d3d5ed50";
    
    const code = await provider.getCode(contractAddress);
    console.log("Contract code length:", code.length);
    
    // Check if d2a7ff4e block has CALLVALUE check
    const hex = code.substring(2);
    const createFunc = "d2a7ff4e";
    const createIndex = hex.indexOf(createFunc);
    console.log("Found function signature at index:", createIndex);
    
    // The next few bytes will give us the jump destination
    // 80 63 d2a7ff4e 14 61 [xx yy] 57
    const jumpDestHex = hex.substr(createIndex + 12, 4);
    const jumpDest = parseInt(jumpDestHex, 16);
    console.log("Jumps to PC:", jumpDest, " (0x" + jumpDestHex + ")");
    
    // Look at the bytecode at jumpDest
    // 1 byte = 2 hex chars
    const blockStart = jumpDest * 2;
    const blockCode = hex.substr(blockStart, 20);
    console.log("Bytecode at jump dest:", blockCode);
    
    if (blockCode.startsWith("5b348015")) {
        console.log("WARNING: Function has a non-payable check (CALLVALUE DUP1 ISZERO)!");
    } else {
        console.log("Function appears to be payable (or no check found immediately).");
    }
}

main();
