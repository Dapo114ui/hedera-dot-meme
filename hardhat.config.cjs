// Explicit .cjs extension: the app's package.json sets "type": "module"
// for the Vite frontend, but Hardhat's config/test loading here needs
// CommonJS. This file and everything under test/contracts/*.cjs are
// isolated from that via extension, not by changing the app's module type.
require("@nomicfoundation/hardhat-toolbox");

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
};
