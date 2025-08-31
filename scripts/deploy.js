import pkg from 'hardhat';
const { ethers } = pkg;
async function main() {
  console.log("🚀 Starting Factory deployment to localhost...");

  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);

  // 1. פריסת ContractFactory בלבד
  console.log("📦 Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();
  
  console.log("✅ ContractFactory deployed to:", factoryAddress);
  console.log("🎉 Factory deployment completed successfully!");
  console.log("\n📋 Next steps:");
  console.log("1. The Factory will create other contracts on-demand");
  console.log("2. Use factory.createRentContract() to create rent agreements");
  console.log("3. Use factory.createNDA() to create NDA agreements");
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});