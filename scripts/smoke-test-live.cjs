// Manual, real-testnet-HBAR-spending smoke test for an already-deployed
// OnycBondingCurve. Distinct from test/contracts/*.test.cjs (which run
// against a mocked HTS precompile on a local EVM, for free, on every
// commit) - this one actually calls create()/buy()/sell() against the
// real contract and the real 0x167 precompile, to confirm the mocked
// test suite's assumptions hold against genuine Hedera behavior.
//
// Usage:
//   CURVE_ADDRESS=0x... npx hardhat run scripts/smoke-test-live.cjs --network hederaTestnet
//
// Costs real (test) HBAR: the configured creation fee (45 HBAR by
// default) plus whatever buy/sell amounts are set below. Uses whichever
// account DEPLOYER_PRIVATE_KEY resolves to for every step (creator,
// buyer, and seller are all the same account here, for simplicity).
//
// SCALE NOTE (see contracts/test/ValueScaleProbe.sol for how this was
// confirmed): inside the contract, msg.value/native-HBAR state is in
// 8-decimal tinybars. But the OUTER transaction's value field - what
// this script must put in {value: ...} for create()/buy() - is still
// the standard 18-decimal EVM convention; Hedera only rescales at that
// RPC boundary. So plain view-function arguments representing an HBAR
// amount (previewBuy's hbarAmountIn, sell's minHbarOut) use
// ethers.parseUnits(_, 8), while an actual transaction's {value: ...}
// uses ethers.parseEther (equivalently: tinybars * 10n**10n).
const { ethers } = require("hardhat");

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const fmtHbar = (tinybars) => ethers.formatUnits(tinybars, 8);

async function main() {
  const curveAddress = process.env.CURVE_ADDRESS;
  if (!curveAddress) throw new Error("CURVE_ADDRESS env var is required.");

  const [signer] = await ethers.getSigners();
  console.log(`Using account: ${signer.address}`);
  console.log(`Balance before: ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} HBAR`);

  const curve = await ethers.getContractAt("OnycBondingCurve", curveAddress, signer);

  const creationFeeTinybars = await curve.creationFeeTinybars();
  const creationFeeForTx = creationFeeTinybars * 10n ** 10n; // tinybars -> outer 18-decimal value field
  console.log(`\n--- create() ---`);
  console.log(`Creation fee required: ${fmtHbar(creationFeeTinybars)} HBAR`);

  const createTx = await curve.create("Smoke Test Meme", "SMOKE", "ipfs://smoke-test", {
    value: creationFeeForTx,
  });
  const createReceipt = await createTx.wait();
  const createdEvent = createReceipt.logs
    .map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "MemeCreated");
  const tokenAddress = createdEvent.args.tokenAddress;
  console.log(`Tx: ${createTx.hash}`);
  console.log(`New token address: ${tokenAddress}`);

  let meme = await curve.memeTokens(tokenAddress);
  console.log(`Curve state after create: virtualHbarReserve=${fmtHbar(meme.virtualHbarReserve)} HBAR, virtualTokenReserve=${meme.virtualTokenReserve}, graduated=${meme.graduated}`);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  console.log(`\n--- buy() ---`);
  const buyAmountHbar = "5";
  const buyAmountTinybars = ethers.parseUnits(buyAmountHbar, 8); // for previewBuy's plain argument
  const buyAmountForTx = ethers.parseEther(buyAmountHbar); // for the actual transaction's value field
  const expectedTokens = await curve.previewBuy(tokenAddress, buyAmountTinybars);
  console.log(`Spending ${buyAmountHbar} HBAR, expecting ~${expectedTokens} tokens (8 decimals)`);

  const buyTx = await curve.buy(tokenAddress, expectedTokens, { value: buyAmountForTx });
  await buyTx.wait();
  console.log(`Tx: ${buyTx.hash}`);

  const tokenBalance = await token.balanceOf(signer.address);
  console.log(`Actual token balance after buy: ${tokenBalance}`);

  meme = await curve.memeTokens(tokenAddress);
  console.log(`Curve state after buy: realHbarReserve=${fmtHbar(meme.realHbarReserve)} HBAR, tokensSold=${meme.tokensSold}`);

  console.log(`\n--- sell() ---`);
  const sellAmount = tokenBalance / 2n; // sell half of what we bought
  console.log(`Approving curve to spend ${sellAmount} tokens...`);
  const approveTx = await token.approve(curveAddress, sellAmount);
  await approveTx.wait();
  console.log(`Approve tx: ${approveTx.hash}`);

  const expectedHbarOut = await curve.previewSell(tokenAddress, sellAmount); // tinybars
  console.log(`Selling ${sellAmount} tokens, expecting ~${fmtHbar(expectedHbarOut)} HBAR back`);

  const sellTx = await curve.sell(tokenAddress, sellAmount, expectedHbarOut);
  await sellTx.wait();
  console.log(`Tx: ${sellTx.hash}`);

  const tokenBalanceAfterSell = await token.balanceOf(signer.address);
  console.log(`Token balance after sell: ${tokenBalanceAfterSell} (was ${tokenBalance})`);

  meme = await curve.memeTokens(tokenAddress);
  console.log(`Final curve state: realHbarReserve=${fmtHbar(meme.realHbarReserve)} HBAR, tokensSold=${meme.tokensSold}, graduated=${meme.graduated}`);

  console.log(`\nBalance after: ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} HBAR`);
  console.log(`\nAll three calls succeeded. Token: ${tokenAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
