// ESM version of hardhat.config.cjs
import "@nomicfoundation/hardhat-toolbox";
// import 'hardhat-deploy';
// optional dynamic imports executed without top-level await so the config stays sync-importable by Hardhat
import('hardhat-contract-sizer').catch(() => {});
import { task } from 'hardhat/config.js';
import('dotenv').then(d => d.config()).catch(() => { console.warn('[warn] dotenv not installed, skipping .env load'); });

// Import CCIP tasks
import('./tasks/ccip/index.js').catch(() => { console.warn('[warn] CCIP tasks not available'); });

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
        url: process.env.ALCHEMY_URL || "https://eth-mainnet.g.alchemy.com/v2/C71xjjRnVc5bmInmm-AQ3",
        enabled: (process.env.USE_FORK === 'true') || false,
        blockNumber: process.env.FORK_BLOCK_NUMBER ? Number(process.env.FORK_BLOCK_NUMBER) : 20500000
      },
      // Fix ProviderError: Transaction maxFeePerGas is too low
      mining: {
        auto: true,
        interval: 0
      },
      // Set high enough gas fees for tests
      initialBaseFeePerGas: 0,
      blockGasLimit: 30000000,
      allowUnlimitedContractSize: true,
      gas: "auto",
      gasPrice: 30000000000,
      maxFeePerGas: 300000000000,
      maxPriorityFeePerGas: 30000000000
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      namedAccounts: {
        deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        Account1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        Account2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        Account3: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        Account4: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
        Account5: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
        Account6: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
        Account7: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
        Account8: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
        Account9: "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
        Account10: "0xBcd4042DE499D14e55001CcbB24a551F3b954096",
        Account11: "0x71bE63f3384f5fb98995898A86B02Fb2426c5788",
        Account12: "0xFABB0ac9d68B0B445fB7357272Ff202C5651694a",
        Account13: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
        Account14: "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097",
        Account15: "0xcd3B766CCDd6AE721141F452C550Ca635964ce71",
        Account16: "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
        Account17: "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E",
        Account18: "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
        Account19: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"
      }
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
