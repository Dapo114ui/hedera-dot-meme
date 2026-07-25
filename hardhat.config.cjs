// Explicit .cjs extension: the app's package.json sets "type": "module"
// for the Vite frontend, but Hardhat's config/test loading here needs
// CommonJS. This file and everything under test/contracts/*.cjs are
// isolated from that via extension, not by changing the app's module type.
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
  },
  networks: {
    hederaTestnet: {
      url: "https://testnet.hashio.io/api",
      chainId: 296,
      // Only populated if DEPLOYER_PRIVATE_KEY is set - lets `hardhat
      // compile`/`hardhat test` run with no key present at all, and
      // fails with Hardhat's own clear "no signer" error only if you
      // actually try to deploy without one.
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
