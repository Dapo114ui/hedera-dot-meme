// Submits OnycBondingCurve to Sourcify (the verification registry
// Hashscan reads from for Hedera contracts) - confirmed against
// Sourcify's own v2 swagger (https://sourcify.dev/server/api-docs/swagger.json),
// not guessed. Run this AFTER a real deployment (needs the address).
//
// Usage:
//   npx hardhat compile   # only if you haven't already
//   CONTRACT_ADDRESS=0x... node scripts/verify-sourcify.cjs
//
// Optional:
//   CREATION_TX_HASH=0x...   # the deploy transaction's hash, if you have it
const fs = require("fs");
const path = require("path");

const SOURCIFY_SERVER = "https://sourcify.dev/server";
const CHAIN_ID = "296"; // Hedera Testnet
const CONTRACT_IDENTIFIER = "contracts/OnycBondingCurve.sol:OnycBondingCurve";

function findBuildInfo() {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${dir} not found - run "npx hardhat compile" first so a build-info file exists.`
    );
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`No build-info JSON files in ${dir} - run "npx hardhat compile" first.`);
  }
  // Newest file's stdJsonInput is what we want to submit - just built.
  const newest = files
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
  return JSON.parse(fs.readFileSync(path.join(dir, newest), "utf8"));
}

async function pollVerification(verificationId) {
  const url = `${SOURCIFY_SERVER}/v2/verify/${verificationId}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(url);
    const body = await res.json();
    if (body.isJobCompleted) return body;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timed out waiting for Sourcify to finish verifying.");
}

async function main() {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) throw new Error("CONTRACT_ADDRESS env var is required.");

  const buildInfo = findBuildInfo();
  const stdJsonInput = buildInfo.input;
  const compilerVersion = buildInfo.solcLongVersion;

  const payload = {
    stdJsonInput,
    compilerVersion,
    contractIdentifier: CONTRACT_IDENTIFIER,
  };
  if (process.env.CREATION_TX_HASH) {
    payload.creationTransactionHash = process.env.CREATION_TX_HASH;
  }

  console.log(`Submitting ${address} (chain ${CHAIN_ID}) to Sourcify...`);
  const submitRes = await fetch(`${SOURCIFY_SERVER}/v2/verify/${CHAIN_ID}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const submitBody = await submitRes.json();

  if (!submitRes.ok || !submitBody.verificationId) {
    console.error("Submission failed:", JSON.stringify(submitBody, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(`Submitted. verificationId: ${submitBody.verificationId}`);
  console.log("Polling for result...");
  const result = await pollVerification(submitBody.verificationId);

  console.log("------------------------------------------------------------");
  console.log(JSON.stringify(result, null, 2));
  console.log("------------------------------------------------------------");
  if (result.contract?.match) {
    console.log(`Verified: match = ${result.contract.match}`);
    console.log(`View on Hashscan: https://hashscan.io/testnet/contract/${address}`);
  } else {
    console.log("Verification did not report a match - see the full response above.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
