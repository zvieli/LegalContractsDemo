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
    overrides: {
      "contracts/NDA/OracleArbitratorFunctions.sol": {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 150 },
          viaIR: true
        }
      }
    }
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

// Custom task to check LINK balance on Sepolia
task("link-balance", "Print LINK balance for address on Sepolia")
  .addOptionalParam("address", "Target address (defaults to first signer)")
  .setAction(async (args, hre) => {
    const target = args.address || (await hre.ethers.getSigners())[0].address;
    if (!hre.ethers.isAddress(target)) {
      throw new Error(`Invalid address: ${target}`);
    }
    const LINK = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
    const abi = ["function balanceOf(address) view returns (uint256)"]; 
    const link = new hre.ethers.Contract(LINK, abi, hre.ethers.provider);
    const bal = await link.balanceOf(target);
    console.log(`Address: ${target}`);
    console.log(`Raw: ${bal.toString()}`);
    console.log(`LINK: ${hre.ethers.formatUnits(bal, 18)}`);
  });