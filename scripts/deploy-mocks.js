import pkg from 'hardhat';
const { ethers } = pkg;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Deploy MockPriceFeed with initial price (e.g. $2000)
  const initialPrice = 2000; // USD
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = await MockPriceFeed.deploy(initialPrice);
  await mockPriceFeed.waitForDeployment();
  const mockPriceFeedAddress = await mockPriceFeed.getAddress();
  console.log("MockPriceFeed deployed to:", mockPriceFeedAddress);

  // Deploy MockERC20
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockERC20 = await MockERC20.deploy("MockToken", "MOCK", 18);
  await mockERC20.waitForDeployment();
  const mockERC20Address = await mockERC20.getAddress();
  console.log("MockERC20 deployed to:", mockERC20Address);

  // === Save deployment.json ===
  const deploymentData = {
    contracts: {
      MockPriceFeed: mockPriceFeedAddress,
      MockERC20: mockERC20Address,
    },
  };

  const frontendContractsDir = path.join(
    __dirname,
    "../front/src/utils/contracts"
  );
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }
  const deploymentFile = path.join(frontendContractsDir, "MockContracts.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log("💾 Mock deployment saved to frontend:", deploymentFile);

  // === Copy ABIs ===
  const abiSourceDir = path.join(__dirname, "../artifacts/contracts/Rent");
  const contractsToCopy = [
    "MockPriceFeed.sol",
    "MockERC20.sol",
  ];

  contractsToCopy.forEach((contractFile) => {
    const contractName = contractFile.replace(".sol", "");
    const artifactPath = path.join(
      abiSourceDir,
      contractFile,
      `${contractName}.json`
    );
    if (fs.existsSync(artifactPath)) {
      try {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        const abiData = {
          abi: artifact.abi,
          contractName: contractName,
          bytecode: artifact.bytecode,
        };
        const destPath = path.join(
          frontendContractsDir,
          `${contractName}ABI.json`
        );
        fs.writeFileSync(destPath, JSON.stringify(abiData, null, 2));
        console.log(`✅ Copied ${contractName} ABI`);
      } catch (error) {
        console.error(`❌ Error copying ${contractName}:`, error.message);
      }
    } else {
      console.log(`⚠️  Artifact not found for: ${contractName}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
