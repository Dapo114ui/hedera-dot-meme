import { Interface } from 'ethers';

async function testLoadMarkets() {
    console.log("Fetching logs...");
    const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/0x9A78619072d24d26e6c3159B4E52D4D3f5D6990a/results/logs?order=desc`);
    const data = await response.json();
    
    const ABI_V2 = [
        "event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl)"
    ];
    const iface = new Interface(ABI_V2);

    data.logs.forEach(log => {
        try {
            const parsedLog = iface.parseLog({
                data: log.data,
                topics: log.topics
            });
            console.log("Log parsed:", parsedLog.name, parsedLog.args.name);
        } catch(e) {
            console.error("Error parsing log:", e.message);
        }
    });
}

testLoadMarkets().catch(console.error);
