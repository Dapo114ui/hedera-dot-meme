const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
    
    const tx = {
        from: "0xbac1daf1b340cb93ac4f3f21e0f5e6130fc7c083",
        to: "0x4398f0b1E6400E7D2912204B88EF13654D016229",
        gasLimit: "0x3d0900", // 4,000,000
        value: "0x15af1d78b58c40000", // 25 HBAR
        data: "0xe88b3cdf000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000003b9aca000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000b486564657261204d656d6500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044d454d45000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000043697066733a2f2f6261666b726569616e377673703370636476337a6d32356877686d636537756f7274357270356c34346e3362356578767761736b7071727768787900000000000000"
    };

    try {
        console.log("Simulating transaction...");
        const result = await provider.call(tx);
        console.log("Result:", result);
    } catch (error) {
        console.error("Simulation failed!");
        if (error.data) {
            console.error("Revert data:", error.data);
            try {
                // Try to parse the revert reason
                const iface = new ethers.Interface(["error Error(string)"]);
                const decoded = iface.parseError(error.data);
                console.error("Decoded revert:", decoded);
            } catch (e) {
                console.error("Could not decode revert reason.");
            }
        } else {
            console.error(error);
        }
    }
}

main();
