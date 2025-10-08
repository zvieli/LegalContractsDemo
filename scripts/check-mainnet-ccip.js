/**
 * Check Mainnet CCIP Infrastructure
 * Script to verify what CCIP contracts are available on mainnet fork
 */

import pkg from 'hardhat';
const { ethers } = pkg;
async function main() {
  console.log("🔍 Checking Mainnet CCIP Infrastructure...\n");
  
  const provider = ethers.provider;
  const [signer] = await ethers.getSigners();
  
  console.log("🌐 Network:", await provider.getNetwork());
  console.log("👤 Signer:", signer.address);
  console.log("💰 Balance:", ethers.formatEther(await provider.getBalance(signer.address)), "ETH\n");
  
  // Known mainnet addresses
  const addresses = {
    "CCIP Router": "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
    "LINK Token": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "Chainlink ETH/USD Feed": "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
    "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
  };
  
  console.log("🏗️ Checking Contract Availability:");
  console.log("=====================================");
  
  for (const [name, address] of Object.entries(addresses)) {
    try {
      const code = await provider.getCode(address);
      const hasCode = code !== "0x";
      
      console.log(`${hasCode ? '✅' : '❌'} ${name}`);
      console.log(`   Address: ${address}`);
      console.log(`   Has Code: ${hasCode ? 'YES' : 'NO'}`);
      
      if (hasCode && name === "LINK Token") {
        // Try to read LINK token details
        try {
          const linkContract = new ethers.Contract(
            address,
            [
              "function name() view returns (string)",
              "function symbol() view returns (string)",
              "function decimals() view returns (uint8)"
            ],
            provider
          );
          
          const [linkName, symbol, decimals] = await Promise.all([
            linkContract.name(),
            linkContract.symbol(),
            linkContract.decimals()
          ]);
          
          console.log(`   Name: ${linkName}`);
          console.log(`   Symbol: ${symbol}`);
          console.log(`   Decimals: ${decimals}`);
        } catch (error) {
          console.log(`   Could not read token details: ${error.message}`);
        }
      }
      
      if (hasCode && name === "CCIP Router") {
        // Try to check CCIP Router interface
        try {
          const routerContract = new ethers.Contract(
            address,
            [
              "function getSupportedTokens(uint64) view returns (address[])",
              "function isChainSupported(uint64) view returns (bool)"
            ],
            provider
          );
          
          // Check if Ethereum mainnet is supported (chain selector: 5009297550715157269)
          const ethSupported = await routerContract.isChainSupported("5009297550715157269");
          console.log(`   Ethereum Chain Supported: ${ethSupported ? 'YES' : 'NO'}`);
        } catch (error) {
          console.log(`   Could not read router details: ${error.message}`);
        }
      }
      
      console.log("");
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}\n`);
    }
  }
  
  // Check current block
  const blockNumber = await provider.getBlockNumber();
  console.log(`📊 Current Block: ${blockNumber}`);
  
  console.log("\n🎯 Recommendation:");
  console.log("===================");
  
  // Check if we have the core infrastructure
  const linkCode = await provider.getCode(addresses["LINK Token"]);
  const routerCode = await provider.getCode(addresses["CCIP Router"]);
  
  if (linkCode !== "0x" && routerCode !== "0x") {
    console.log("✅ CCIP infrastructure is available on mainnet fork!");
    console.log("✅ We can use real CCIP contracts for our Oracle system");
    console.log("\n📋 Next Steps:");
    console.log("1. Update deployment to use mainnet CCIP addresses");
    console.log("2. Configure chain selectors properly");
    console.log("3. Test with real LINK token (fork has unlimited ETH, can get LINK)");
  } else {
    console.log("❌ CCIP infrastructure not fully available");
    console.log("💡 Recommended approach: Mock/Simulation mode");
    console.log("\n📋 Next Steps:");
    console.log("1. Deploy Mock CCIP contracts");
    console.log("2. Use simulation mode for Oracle functionality");
    console.log("3. Keep hybrid approach for educational purposes");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });