// Deploys OnycBondingCurve to whichever network Hardhat is pointed at.
//
// Usage (testnet):
//   DEPLOYER_PRIVATE_KEY=... PLATFORM_TREASURY_ADDRESS=... \
//     npx hardhat run scripts/deploy-onyc-bonding-curve.cjs --network hederaTestnet
//
// Required env (read via dotenv from a plain `.env` file - NOT
// `.env.local`, and NEVER prefixed VITE_, since Vite exposes anything
// VITE_-prefixed to the browser bundle and this is a private key):
//   DEPLOYER_PRIVATE_KEY      - funded testnet account's raw ECDSA private
//                               key (hex, with or without 0x prefix). This
//                               account pays gas for the deploy and every
//                               create() call's HTS network-fee buffer.
//   PLATFORM_TREASURY_ADDRESS - EVM address that receives creation-fee
//                               margin and trading fees. Can be the same
//                               account as the deployer, or a separate
//                               treasury account's EVM alias.
//
// Optional env (all have defaults matching the values already exercised
// in test/contracts/OnycBondingCurve.test.cjs):
//   CREATION_FEE_HBAR   - default 45 (must be >= 40, the HTS network-cost
//                         buffer the contract forwards to the precompile)
//   TRADING_FEE_BPS     - default 100 (1%), hard-capped at 500 (5%) by
//                         the contract itself
//   FUNDING_GOAL_HBAR   - default 72270 (memejob's own number, kept only
//                         for rough continuity - this is arbitrary and
//                         easy to change)
const { ethers } = require("hardhat");

async function main() {
  const treasury = process.env.PLATFORM_TREASURY_ADDRESS;
  if (!treasury) {
    throw new Error(
      "PLATFORM_TREASURY_ADDRESS is required (EVM address to receive fees)."
    );
  }
  if (!ethers.isAddress(treasury)) {
    throw new Error(`PLATFORM_TREASURY_ADDRESS "${treasury}" is not a valid EVM address.`);
  }

  const creationFeeHbar = process.env.CREATION_FEE_HBAR || "45";
  const tradingFeeBps = Number(process.env.TRADING_FEE_BPS || "100");
  const fundingGoalHbar = process.env.FUNDING_GOAL_HBAR || "72270";

  const creationFeeWeibars = ethers.parseEther(creationFeeHbar);
  const fundingGoalWeibars = ethers.parseEther(fundingGoalHbar);

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available - set DEPLOYER_PRIVATE_KEY and deploy with " +
        "--network hederaTestnet."
    );
  }

  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("------------------------------------------------------------");
  console.log("Deploying OnycBondingCurve");
  console.log("------------------------------------------------------------");
  console.log(`Network:            ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer:           ${deployer.address}`);
  console.log(`Deployer balance:   ${ethers.formatEther(balance)} (native units)`);
  console.log(`Platform treasury:  ${treasury}`);
  console.log(`Creation fee:       ${creationFeeHbar} HBAR`);
  console.log(`Trading fee:        ${tradingFeeBps} bps (${tradingFeeBps / 100}%)`);
  console.log(`Funding goal:       ${fundingGoalHbar} HBAR`);
  console.log("HTS precompile:     0x167 (default - address(0) passed, contract resolves it)");
  console.log("------------------------------------------------------------");

  const Curve = await ethers.getContractFactory("OnycBondingCurve");
  const curve = await Curve.deploy(
    treasury,
    creationFeeWeibars,
    tradingFeeBps,
    fundingGoalWeibars,
    ethers.ZeroAddress // resolves to the real 0x167 HTS precompile inside the contract
  );
  await curve.waitForDeployment();
  const address = await curve.getAddress();

  const deployTx = curve.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log("------------------------------------------------------------");
  console.log("Deployed successfully.");
  console.log(`Contract address:   ${address}`);
  if (deployTx) console.log(`Deploy tx hash:     ${deployTx.hash}`);
  if (receipt) console.log(`Gas used:           ${receipt.gasUsed.toString()}`);
  console.log("------------------------------------------------------------");
  console.log("Next steps:");
  console.log("  1. Verify on Sourcify (Hashscan's verification registry):");
  console.log(
    `     see scripts/verify-sourcify.cjs, or submit manually at https://sourcify.dev`
  );
  console.log("     for chainId 296 (Hedera Testnet).");
  console.log("  2. This is a fresh, unaudited contract - keep it on testnet");
  console.log("     only until it's had real review.");
  console.log("  3. Frontend integration (coin.js/mirror-trades.js/script.js)");
  console.log("     is a separate, not-yet-done phase.");
  console.log("------------------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
