const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const Probe = await ethers.getContractFactory("ValueScaleProbe");
  const probe = await Probe.deploy();
  await probe.waitForDeployment();
  console.log("Probe deployed at:", await probe.getAddress());

  const sentValue = ethers.parseEther("1"); // 1 * 10^18, standard "1 ether"-style value
  console.log("Sending value (18-decimal weibar-equivalent):", sentValue.toString());

  const tx = await probe.probe({ value: sentValue });
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((l) => { try { return probe.interface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "Probe");

  console.log("msg.value reported inside contract:      ", event.args.msgValue.toString());
  console.log("address(this).balance reported inside:   ", event.args.balanceAfter.toString());

  const contractBalanceViaRpc = await ethers.provider.getBalance(await probe.getAddress());
  console.log("address(this).balance via eth_getBalance:", contractBalanceViaRpc.toString());
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
