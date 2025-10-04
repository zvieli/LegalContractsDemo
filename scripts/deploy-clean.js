import "dotenv/config";
import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Starting Clean V7 deployment...");

  const [deployer, tenant] = await ethers.getSigners();
  console.log("📝 Deploying with deployer:", deployer.address, " tenant:", tenant.address);

  // === 1. Deploy ContractFactory ===
  console.log("📦 Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();

  console.log("✅ ContractFactory deployed to:", factoryAddress);

  // === 1.1 Set Chainlink price feed address ===
  // Use ETH/USD aggregator for Mainnet and Hardhat fork
  // Mainnet: 0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419
  let priceFeedAddress = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
  if (network.name === "mainnet" || network.name === "hardhat") {
    priceFeedAddress = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
  } else if (network.name === "sepolia") {
    // Sepolia ETH/USD aggregator
    priceFeedAddress = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
  } // Add more networks as needed

  console.log(`🔗 Using Chainlink price feed: ${priceFeedAddress}`);

  // Ensure frontend public contracts dir exists
  const frontendPublicContractsDir = path.resolve(__dirname, '..', 'front', 'public', 'utils', 'contracts');
  try {
    fs.mkdirSync(frontendPublicContractsDir, { recursive: true });
  } catch (e) {
    console.error('❌ Could not create frontend public contracts directory:', frontendPublicContractsDir, e.message || e);
    throw e;
  }

  // === 2. Save deployment.json ===
  const deploymentData = {
    network: network.name,
    contracts: {
      ContractFactory: factoryAddress,
    },
  };

  // Write ContractFactory.json to public
  const publicDeploymentFile = path.join(frontendPublicContractsDir, "ContractFactory.json");
  try {
    fs.writeFileSync(publicDeploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log("💾 Deployment saved to frontend public:", publicDeploymentFile);
  } catch (e) {
    console.error('❌ Could not write ContractFactory.json to frontend public:', publicDeploymentFile, e.message || e);
    throw e;
  }

  // === 3. Sanity check ===
  try {
    const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const code = await provider.getCode(factoryAddress);
    if (!code || code === '0x') {
      throw new Error(`No contract code found at factory address ${factoryAddress}.`);
    }
    console.log(`🔍 Sanity check OK: factory code size ${code.length / 2} bytes`);
  } catch (err) {
    console.error('❌ Deploy sanity check failed:', err.message || err);
    throw err;
  }

  // === 4. Deploy ArbitrationService ===
  let arbitrationServiceAddress = null;
  let deployArbitration = String(process.env.DEPLOY_ARBITRATION || 'true').toLowerCase() === 'true';

  if (deployArbitration) {
    console.log("📦 Deploying ArbitrationService...");
    const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
    const arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();
    arbitrationServiceAddress = await arbitrationService.getAddress();

    console.log("✅ ArbitrationService deployed to:", arbitrationServiceAddress);

    // Configure factory with arbitration service
    const factoryContract = await ethers.getContractAt("ContractFactory", factoryAddress);
    try {
      await factoryContract.setArbitrationService(arbitrationServiceAddress);
      console.log("✅ ContractFactory configured with ArbitrationService");
    } catch (e) {
      console.warn("⚠️ Could not set arbitration service in factory:", e.message || e);
    }
  }

  // === 5. Deploy RecipientKeyRegistry ===
  console.log("📦 Deploying RecipientKeyRegistry...");
  const RecipientKeyRegistry = await ethers.getContractFactory("RecipientKeyRegistry");
  const keyRegistry = await RecipientKeyRegistry.deploy();
  await keyRegistry.waitForDeployment();
  const keyRegistryAddress = await keyRegistry.getAddress();

  console.log("✅ RecipientKeyRegistry deployed to:", keyRegistryAddress);

  // === 6. Deploy Arbitrator Oracle ===
  console.log("📦 Deploying Arbitrator...");
  const Arbitrator = await ethers.getContractFactory("Arbitrator");
  const arbitrator = await Arbitrator.deploy();
  await arbitrator.waitForDeployment();
  const arbitratorAddress = await arbitrator.getAddress();

  console.log("✅ Arbitrator deployed to:", arbitratorAddress);

  // === 7. Copy all ABIs ===
  console.log("📋 Copying ABIs...");
  
  // Copy individual contract ABIs
  const contractsToCopy = [
    'ContractFactory',
    'ArbitrationService', 
    'RecipientKeyRegistry',
    'Arbitrator',
    'TemplateRentContract'
  ];

  for (const contractName of contractsToCopy) {
    try {
      const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts');
      let sourceFile;
      
      // Handle different folder structures
      if (contractName === 'TemplateRentContract') {
        sourceFile = path.join(artifactPath, 'Rent', `${contractName}.sol`, `${contractName}.json`);
      } else {
        sourceFile = path.join(artifactPath, `${contractName}.sol`, `${contractName}.json`);
      }
      
      const destFile = path.join(frontendPublicContractsDir, `${contractName}.json`);
      
      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, destFile);
        console.log(`📋 Copied ${contractName}.json`);
      } else {
        console.warn(`⚠️ Could not find artifact for ${contractName} at ${sourceFile}`);
      }
    } catch (e) {
      console.warn(`⚠️ Could not copy ${contractName} ABI:`, e.message);
    }
  }

  // === 8. Create deployment summary ===
  const deploymentSummary = {
    network: network.name,
    chainId: network.config?.chainId || 31337,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ContractFactory: factoryAddress,
      ArbitrationService: arbitrationServiceAddress,
      RecipientKeyRegistry: keyRegistryAddress,
      Arbitrator: arbitratorAddress
    }
  };

  // Write deployment summary
  const summaryFile = path.join(frontendPublicContractsDir, "deployment-summary.json");
  try {
    fs.writeFileSync(summaryFile, JSON.stringify(deploymentSummary, null, 2));
    console.log("💾 Deployment summary saved:", summaryFile);
  } catch (e) {
    console.warn('⚠️ Could not write deployment summary:', e.message);
  }

  console.log("\n🎉 Clean V7 deployment completed successfully!");
  console.log("📋 Deployment Summary:");
  console.log(`   Network: ${network.name}`);
  console.log(`   ContractFactory: ${factoryAddress}`);
  if (arbitrationServiceAddress) {
    console.log(`   ArbitrationService: ${arbitrationServiceAddress}`);
  }
  console.log(`   RecipientKeyRegistry: ${keyRegistryAddress}`);
  console.log(`   Arbitrator: ${arbitratorAddress}`);
  console.log(`   Frontend contracts: ${frontendPublicContractsDir}`);
}

main().catch((error) => {
  console.error("💥 Deployment failed:", error);
  process.exitCode = 1;
});