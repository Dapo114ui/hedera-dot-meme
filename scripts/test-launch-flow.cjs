// Replicates script.js's OnycBondingCurve create() branch exactly
// (including the mirror-node-based MemeCreated log fetch fix) against the
// real deployed contract, to confirm the fix actually works end-to-end.
// Costs a real creation fee (45 HBAR by default).
const { ethers } = require("hardhat");

const ONYC_BONDING_CURVE_ADDRESS = "0x035b2f0f3306231eec998d23eaf5d08eaa885542";
const ONYC_BONDING_CURVE_ABI = [
  "function create(string name, string symbol, string memo) payable returns (address tokenAddress)",
  "function creationFeeTinybars() view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const onycContract = new ethers.Contract(ONYC_BONDING_CURVE_ADDRESS, ONYC_BONDING_CURVE_ABI, signer);

  const creationFeeTinybars = await onycContract.creationFeeTinybars();
  const valueForTx = creationFeeTinybars * 10n ** 10n;

  console.log(`Creating token, fee: ${ethers.formatUnits(creationFeeTinybars, 8)} HBAR`);
  const tx = await onycContract.create("Launch Flow Test", "LFTEST", "ipfs://launch-flow-test", {
    value: valueForTx,
  });
  console.log(`Tx hash: ${tx.hash}`);
  await tx.wait();
  console.log("Tx confirmed.");

  console.log("Polling mirror node for MemeCreated event...");
  let createdEvent = null;
  for (let attempt = 0; attempt < 8 && !createdEvent; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const resultRes = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${tx.hash}`);
      if (!resultRes.ok) continue;
      const contractResult = await resultRes.json();
      createdEvent = (contractResult.logs || [])
        .map((log) => {
          try {
            return onycContract.interface.parseLog({ topics: log.topics, data: log.data });
          } catch {
            return null;
          }
        })
        .find((e) => e?.name === "MemeCreated") || null;
    } catch (e) {
      // ignore, retry
    }
  }

  if (!createdEvent) {
    console.error("FAILED: MemeCreated event not found via mirror node either.");
    process.exitCode = 1;
    return;
  }

  console.log("SUCCESS - MemeCreated event found via mirror node:");
  console.log("  tokenAddress:", createdEvent.args.tokenAddress);
  console.log("  creator:", createdEvent.args.creator);
  console.log("  name:", createdEvent.args.name);
  console.log("  symbol:", createdEvent.args.symbol);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
