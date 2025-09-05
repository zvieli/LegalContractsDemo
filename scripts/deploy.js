import "dotenv/config";
import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Starting Factory deployment...");

  const [deployer, tenant] = await ethers.getSigners();
  console.log("📝 Deploying with deployer:", deployer.address, " tenant:", tenant.address);

  // === 1. Deploy ContractFactory ===
  console.log("📦 Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();

  console.log("✅ ContractFactory deployed to:", factoryAddress);

  // === 1.5 Deploy mocks: MockERC20 and MockPriceFeed ===
  console.log("📦 Deploying mock tokens and price feed...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockERC20.deploy("Mock Token", "MCK", ethers.parseUnits("1000000", 18));
  await mockToken.waitForDeployment();
  const mockTokenAddress = await mockToken.getAddress();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  // initial price 2000
  const mockPrice = await MockPriceFeed.deploy(2000);
  await mockPrice.waitForDeployment();
  const mockPriceAddress = await mockPrice.getAddress();

  console.log("✅ MockERC20 deployed to:", mockTokenAddress);
  console.log("✅ MockPriceFeed deployed to:", mockPriceAddress);

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
    "../front/src/utils/contracts"
  );
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }

  const deploymentFile = path.join(frontendContractsDir, "ContractFactory.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));

  console.log("💾 Deployment saved to frontend:", deploymentFile);

  // === 2.5 Optionally deploy OracleArbitratorFunctions if router provided ===
  let oracleFunctionsAddress = null;
  try {
    const router = process.env.ORACLE_FUNCTIONS_ROUTER;
    if (router && ethers.isAddress(router)) {
      console.log("📦 Deploying OracleArbitratorFunctions with router:", router);
      const Oracle = await ethers.getContractFactory("OracleArbitratorFunctions");
      const oracle = await Oracle.deploy(router);
      await oracle.waitForDeployment();
      oracleFunctionsAddress = await oracle.getAddress();
      console.log("✅ OracleArbitratorFunctions deployed:", oracleFunctionsAddress);

      // Update deployment data and re-write
      deploymentData.contracts.OracleArbitratorFunctions = oracleFunctionsAddress;
      fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
    } else if (router) {
      console.warn("⚠️  ORACLE_FUNCTIONS_ROUTER provided but not a valid address:", router);
    } else {
      console.log("ℹ️  Skipping OracleArbitratorFunctions (no ORACLE_FUNCTIONS_ROUTER set)");
    }
  } catch (err) {
    console.error("⚠️  Could not deploy OracleArbitratorFunctions:", err.message);
  }

  // === 3. Copy ABIs ===
  console.log("📂 Copying ABI files to frontend...");

  const abiSourceDir = path.join(__dirname, "../artifacts/contracts");

  // Use correct subpaths for artifacts as compiled by Hardhat
  const contractsToCopy = [
    "ContractFactory.sol",
    path.join("Rent", "TemplateRentContract.sol"),
  // Mocks
  path.join("Rent", "MockPriceFeed.sol"),
  path.join("Rent", "MockERC20.sol"),
    path.join("NDA", "NDATemplate.sol"),
    path.join("NDA", "Arbitrator.sol"),
  path.join("NDA", "OracleArbitrator.sol"),
  path.join("NDA", "OracleArbitratorFunctions.sol"),
  ];

  let copiedCount = 0;
  let skippedCount = 0;

  contractsToCopy.forEach((contractFile) => {
  const contractName = path.basename(contractFile).replace(".sol", "");
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

  // === 4. Write MockContracts.json with deployed mock addresses and factory + sample created contract ===
  console.log("💾 Writing MockContracts.json for frontend...");

  // create a sample rent contract via factory to demonstrate flow
  try {
  const tx = await contractFactory.createRentContract(tenant.address, ethers.parseUnits("1", 18), mockPriceAddress);
    const receipt = await tx.wait();
    // ContractFactory emits RentContractCreated(contractAddress, landlord, tenant)
    let rentAddress = null;
    for (const ev of receipt.logs) {
      try {
        const parsed = contractFactory.interface.parseLog(ev);
        if (parsed && parsed.name === "RentContractCreated") {
          rentAddress = parsed.args[0];
          break;
        }
      } catch (e) {
        // ignore non-parsable logs
      }
    }

    const mockContracts = {
      contracts: {
        MockPriceFeed: mockPriceAddress,
        MockERC20: mockTokenAddress,
        ContractFactory: factoryAddress,
        SampleRent: rentAddress || null
      },
    };

    const mockContractsPath = path.join(frontendContractsDir, "MockContracts.json");
    fs.writeFileSync(mockContractsPath, JSON.stringify(mockContracts, null, 2));
    console.log("✅ MockContracts.json written to frontend:", mockContractsPath);
  } catch (err) {
    console.error("⚠️  Could not create sample rent contract via factory:", err.message);
  }

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
