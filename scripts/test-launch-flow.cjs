// Replicates script.js's OnycBondingCurve create() branch exactly
// (including the call_result-based fix for reading the new token's
// address) against the real deployed contract, to confirm it works
// end-to-end. Costs a real creation fee (45 HBAR by default).
//
// Also logs call_result availability vs the MemeCreated log's
// availability at every poll, since a live test found the log lagging
// the base contract-result record by 40+ seconds - this settles (or
// re-confirms) whether call_result really does show up sooner, the
// premise the current fix relies on.
const { ethers } = require("hardhat");

const ONYC_BONDING_CURVE_ADDRESS = "0x035b2f0f3306231eec998d23eaf5d08eaa885542";
const ONYC_BONDING_CURVE_ABI = [
  "function create(string name, string symbol, string memo) payable returns (address tokenAddress)",
  "function creationFeeTinybars() view returns (uint256)",
];
const MEME_CREATED_ABI = ["event MemeCreated(address indexed tokenAddress, address indexed creator, string name, string symbol)"];
const memeCreatedInterface = new ethers.Interface(MEME_CREATED_ABI);

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

  console.log("Polling mirror node (tracking call_result vs MemeCreated log availability)...");
  let createdTokenAddress = null;
  let logSeenAtAttempt = null;
  for (let attempt = 0; attempt < 15 && !createdTokenAddress; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const resultRes = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${tx.hash}`);
      if (!resultRes.ok) {
        console.warn(`poll ${attempt + 1}/15: HTTP ${resultRes.status}, retrying...`);
        continue;
      }
      const contractResult = await resultRes.json();

      const hasCallResult = !!(contractResult.call_result && contractResult.call_result !== "0x");
      const hasLog = (contractResult.logs || [])
        .some((log) => {
          try {
            return memeCreatedInterface.parseLog({ topics: log.topics, data: log.data })?.name === "MemeCreated";
          } catch {
            return false;
          }
        });
      if (hasLog && logSeenAtAttempt === null) logSeenAtAttempt = attempt + 1;

      console.log(`poll ${attempt + 1}/15: call_result=${hasCallResult} MemeCreated_log=${hasLog}`);

      if (hasCallResult) {
        createdTokenAddress = "0x" + contractResult.call_result.replace(/^0x/, "").slice(-40);
      }
    } catch (e) {
      console.warn(`poll ${attempt + 1}/15 failed, retrying:`, e.message);
    }
  }

  if (!createdTokenAddress) {
    console.error("FAILED: call_result not available after 15 polls.");
    process.exitCode = 1;
    return;
  }

  console.log("SUCCESS - token address read from call_result:", createdTokenAddress);
  console.log(
    logSeenAtAttempt === null
      ? "MemeCreated log never appeared within the poll window (confirms it lags call_result)."
      : `MemeCreated log first appeared on poll ${logSeenAtAttempt}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
