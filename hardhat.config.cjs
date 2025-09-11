// ✅ Use CommonJS temporarily
require("@nomicfoundation/hardhat-toolbox");
try { require('hardhat-contract-sizer'); } catch (_) { /* optional */ }
const { task } = require("hardhat/config");
try { require('dotenv').config(); } catch (e) { console.warn('[warn] dotenv not installed, skipping .env load'); }

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 150 }
    },
    // no per-file overrides
    overrides: {}
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    sepolia: {
      url: process.env.RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/REPLACE_KEY",
      chainId: 11155111,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  etherscan: process.env.ETHERSCAN_API_KEY ? { apiKey: process.env.ETHERSCAN_API_KEY } : undefined,
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: false,
  }
};

// Link-balance task removed as part of oracle/chainlink/ai sweep