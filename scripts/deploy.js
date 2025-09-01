import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Starting Factory deployment...");

  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);

  // === 1. Deploy ContractFactory ===
  console.log("📦 Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();

  console.log("✅ ContractFactory deployed to:", factoryAddress);

  // === 2. Save deployment.json ===
  const deploymentData = {
    network: network.name,
    contracts: {
      ContractFactory: factoryAddress,
      // פה תוכל להוסיף חוזים נוספים אם תפרוס אותם
    },
  };

  const frontendContractsDir = path.join(
    __dirname,
    "../legal-contracts-frontend/src/utils/contracts"
  );
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }

  const deploymentFile = path.join(frontendContractsDir, "ContractFactory.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));

  console.log("💾 Deployment saved to frontend:", deploymentFile);

  // === 3. Copy ABIs ===
  console.log("📂 Copying ABI files to frontend...");

  const abiSourceDir = path.join(__dirname, "../artifacts/contracts");

  const contractsToCopy = [
    "ContractFactory.sol",
    "TemplateRentContract.sol",
    "NDATemplate.sol",
    "Arbitrator.sol",
  ];

  let copiedCount = 0;
  let skippedCount = 0;

  contractsToCopy.forEach((contractFile) => {
    const contractName = contractFile.replace(".sol", "");
    const artifactPath = path.join(abiSourceDir, contractFile, `${contractName}.json`);

    if (fs.existsSync(artifactPath)) {
      try {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        const abiData = {
          abi: artifact.abi,
          contractName: contractName,
          bytecode: artifact.bytecode,
        };

        const destPath = path.join(frontendContractsDir, `${contractName}ABI.json`);
        fs.writeFileSync(destPath, JSON.stringify(abiData, null, 2));
        console.log(`✅ Copied ${contractName} ABI`);
        copiedCount++;
      } catch (error) {
        console.error(`❌ Error copying ${contractName}:`, error.message);
      }
    } else {
      console.log(`⚠️  Artifact not found for: ${contractName}`);
      skippedCount++;
    }
  });

  console.log(`🎉 Copied ${copiedCount} ABI files to ${frontendContractsDir}`);
  if (skippedCount > 0) {
    console.log(`⚠️  Skipped ${skippedCount} contracts (not found)`);
  }

  console.log("✅ Deployment & ABI copy finished successfully!");
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});
