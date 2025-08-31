import "@nomicfoundation/hardhat-toolbox";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100  // runs נמוך יותר = חוזה קטן יותר
      },
      viaIR: true  // שימוש ב-IR compiler שיכול לעזור עם חוזים גדולים
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      gas: 30000000,
      gasPrice: 8000000000,
      allowUnlimitedContractSize: true  // מאפשר חוזים ללא הגבלת גודל ב-localhost
    }
  }
};