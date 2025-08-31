import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { copyABI } from "./copy-abi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Starting deployment of LegalContracts...");

  // 1. compile החוזים לפני פריסה
  console.log("🔨 Compiling contracts...");
  await hre.run('compile');
  console.log("✅ Contracts compiled");

  // 2. העתקת ABI לפרונטאנד
  console.log("📋 Copying ABI files to frontend...");
  copyABI();

  // 3. פריסת ContractFactory
  console.log("📦 Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();
  console.log("✅ ContractFactory deployed to:", factoryAddress);

  // 4. פריסת TemplateRentContract
  console.log("🏠 Deploying TemplateRentContract...");
  const TemplateRentContract = await ethers.getContractFactory("TemplateRentContract");
  const templateRentContract = await TemplateRentContract.deploy();
  await templateRentContract.waitForDeployment();
  const rentTemplateAddress = await templateRentContract.getAddress();
  console.log("✅ TemplateRentContract deployed to:", rentTemplateAddress);

  // 5. פריסת NDATemplate
  console.log("📝 Deploying NDATemplate...");
  const NDATemplate = await ethers.getContractFactory("NDATemplate");
  const ndaTemplate = await NDATemplate.deploy();
  await ndaTemplate.waitForDeployment();
  const ndaTemplateAddress = await ndaTemplate.getAddress();
  console.log("✅ NDATemplate deployed to:", ndaTemplateAddress);

  // 6. פריסת Arbitrator
  console.log("⚖️ Deploying Arbitrator...");
  const Arbitrator = await ethers.getContractFactory("Arbitrator");
  const arbitrator = await Arbitrator.deploy();
  await arbitrator.waitForDeployment();
  const arbitratorAddress = await arbitrator.getAddress();
  console.log("✅ Arbitrator deployed to:", arbitratorAddress);

  // 7. הגדרת הטמפלטים ב-Factory
  console.log("🔄 Setting templates in ContractFactory...");
  await contractFactory.setRentTemplate(rentTemplateAddress);
  await contractFactory.setNdaTemplate(ndaTemplateAddress);
  await contractFactory.setArbitrator(arbitratorAddress);
  console.log("✅ Templates configured in ContractFactory");

  // 8. שמירת כתובות הפריסה לקובץ
  const network = hre.network;
  const deploymentData = {
    network: network.name,
    chainId: network.config.chainId,
    timestamp: new Date().toISOString(),
    contracts: {
      ContractFactory: factoryAddress,
      TemplateRentContract: rentTemplateAddress,
      NDATemplate: ndaTemplateAddress,
      Arbitrator: arbitratorAddress
    }
  };

  // יצירת תיקיית deployments אם לא קיימת
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // שמירת הנתונים לקובץ JSON
  const deploymentFile = path.join(deploymentsDir, `deployment-${network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));

  console.log("📁 Deployment data saved to:", deploymentFile);

  // 9. יצירת קובץ addresses עבור הפרונטאנד
  const frontendAddresses = {
    [network.config.chainId]: {
      factory: factoryAddress,
      rentTemplate: rentTemplateAddress,
      ndaTemplate: ndaTemplateAddress,
      arbitrator: arbitratorAddress
    }
  };

  const addressesDir = path.join(__dirname, "../src/config");
  if (!fs.existsSync(addressesDir)) {
    fs.mkdirSync(addressesDir, { recursive: true });
  }

  const addressesFile = path.join(addressesDir, "deployedAddresses.json");
  fs.writeFileSync(addressesFile, JSON.stringify(frontendAddresses, null, 2));

  console.log("🌐 Frontend addresses saved to:", addressesFile);

  // 10. העתקת ABI שוב לאחר פריסה
  console.log("📋 Copying final ABI files...");
  copyABI();

  // 11. הדפסת מידע לבדיקה
  console.log("\n📋 Deployment Summary:");
  console.log("====================");
  console.log("Network:", network.name);
  console.log("Chain ID:", network.config.chainId);
  console.log("ContractFactory:", factoryAddress);
  console.log("TemplateRentContract:", rentTemplateAddress);
  console.log("NDATemplate:", ndaTemplateAddress);
  console.log("Arbitrator:", arbitratorAddress);
  
  console.log("🎉 Deployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });