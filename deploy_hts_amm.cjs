const hre = require("hardhat");
const fs = require('fs');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying TokenFactoryHTS with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const TokenFactoryHTS = await hre.ethers.getContractFactory("TokenFactoryHTS");
  const factory = await TokenFactoryHTS.deploy({ gasLimit: 5000000 });

  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log("TokenFactoryHTS deployed to:", factoryAddress);

  // Save the address to contract_info.json so frontend can read it
  const contractInfo = {
    factoryAddress: factoryAddress,
    network: hre.network.name
  };

  fs.writeFileSync('contract_info.json', JSON.stringify(contractInfo, null, 2));
  console.log("Saved contract address to contract_info.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
