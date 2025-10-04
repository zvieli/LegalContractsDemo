// ESM version of hardhat.config.cjs
import "@nomicfoundation/hardhat-toolbox";
// optional dynamic imports executed without top-level await so the config stays sync-importable by Hardhat
import('hardhat-contract-sizer').catch(() => {});
import { task } from 'hardhat/config.js';
import('dotenv').then(d => d.config()).catch(() => { console.warn('[warn] dotenv not installed, skipping .env load'); });

export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 150 },
      viaIR: true
    },
    // no per-file overrides
    overrides: {}
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: "https://eth-mainnet.g.alchemy.com/v2/C71xjjRnVc5bmInmm-AQ3",
        enabled: true
      }
    },
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
  gasReporter: {
    enabled: true,
    currency: 'USD',
    showTimeSpent: true
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
