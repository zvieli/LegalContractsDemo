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

  // === SANITY CHECK: ensure the deployed factory has code on-chain ===
  try {
    const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const code = await provider.getCode(factoryAddress);
    if (!code || code === '0x') {
      throw new Error(`No contract code found at factory address ${factoryAddress}. Make sure the chain you're deploying to matches the configured frontend network and the node is running.`);
    }
    console.log(`🔍 Sanity check OK: factory code size ${code.length / 2} bytes`);
  } catch (err) {
    console.error('❌ Deploy sanity check failed:', err.message || err);
    throw err;
  }

  // === 2.5 Deploy ArbitrationService and configure factory ===
  console.log("📦 Deploying ArbitrationService...");
  let arbitrationServiceAddress = null;
  try {
    const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
    const arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();
    arbitrationServiceAddress = await arbitrationService.getAddress();
    console.log("✅ ArbitrationService deployed to:", arbitrationServiceAddress);

    // Configure the ArbitrationService to trust the ContractFactory so the
    // factory can call `applyResolutionToTarget` when driving dispute resolutions.
    try {
      const tx = await arbitrationService.setFactory(factoryAddress);
      await tx.wait();
      console.log("🔧 ArbitrationService.factory set to ContractFactory:", factoryAddress);
    } catch (err) {
      console.warn("⚠️  Could not set ArbitrationService.factory:", err.message || err);
    }

    // Update the previously-written ContractFactory.json to include the service
    try {
      const deploymentFileContents = fs.readFileSync(deploymentFile, 'utf8');
      const parsed = JSON.parse(deploymentFileContents);
      parsed.contracts = parsed.contracts || {};
      parsed.contracts.ArbitrationService = arbitrationServiceAddress;
      fs.writeFileSync(deploymentFile, JSON.stringify(parsed, null, 2));
      console.log("💾 Updated ContractFactory.json with ArbitrationService address");
    } catch (err) {
      console.warn("⚠️  Could not update ContractFactory.json with ArbitrationService address:", err.message || err);
    }
  } catch (err) {
    console.warn('⚠️  ArbitrationService deploy failed:', err.message || err);
  }

  // OracleArbitratorFunctions deployment removed in sweep

  // === 3. Copy ABIs ===
  console.log("📂 Copying ABI files to frontend...");

  const abiSourceDir = path.join(__dirname, "../artifacts/contracts");
  // Scan the Hardhat artifacts/contracts directory and copy every contract artifact
  // This makes the deploy script resilient to added/removed contracts and ensures
  // the frontend has the exact ABIs produced by the current compile.
  let copiedCount = 0;
  let skippedCount = 0;

  const walkAndCopy = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // artifact subdirs typically correspond to source file paths (e.g. NDA)
        walkAndCopy(full);
      } else if (ent.isFile() && ent.name.endsWith('.json')) {
        // skip debug-only artifact files and any artifacts that live under
        // a `testing` or `test-mocks` source directory (these are test contracts)
        if (full.includes(`${path.sep}testing${path.sep}`) || full.includes(`${path.sep}test-mocks${path.sep}`) || ent.name.endsWith('.dbg.json')) {
          skippedCount++;
          console.log(`⏭ Skipping test/debug artifact: ${full}`);
          continue;
        }

        try {
          const artifact = JSON.parse(fs.readFileSync(full, 'utf8'));
          // If the artifact's contract name looks like a test (contains "test"), skip it
          if (artifact.contractName && /test/i.test(artifact.contractName)) {
            skippedCount++;
            console.log(`⏭ Skipping test artifact by name: ${artifact.contractName}`);
            continue;
          }
          // artifact.contractName is usually present; fall back to filename
          const contractName = artifact.contractName || path.basename(ent.name, '.json');
          // Some artifact JSONs are debug/interface-only and contain no bytecode.
          // Prefer the full `bytecode` when available, otherwise fall back to
          // `deployedBytecode`. If neither exists (interfaces/abstracts), write null.
          const chosenBytecode = (artifact.bytecode && artifact.bytecode.length > 2)
            ? artifact.bytecode
            : (artifact.deployedBytecode && artifact.deployedBytecode.length > 2)
              ? artifact.deployedBytecode
              : null;

          // Skip debug-only artifacts (hardhat sometimes produces .dbg JSON or
          // artifacts that clearly do not represent a deployable contract).
          // We treat an artifact with empty ABI as non-deployable and skip it.
          if (!artifact.abi || !Array.isArray(artifact.abi) || artifact.abi.length === 0) {
            // skip interface/debug artifacts
            skippedCount++;
            console.log(`⏭ Skipping ${contractName} (no ABI or interface-only artifact)`);
            continue;
          }

          const abiData = {
            abi: artifact.abi || [],
            contractName: contractName,
            bytecode: chosenBytecode,
          };

          const destPath = path.join(frontendContractsDir, `${contractName}ABI.json`);
          fs.writeFileSync(destPath, JSON.stringify(abiData, null, 2));
          console.log(`✅ Copied ${contractName} ABI`);
          copiedCount++;
        } catch (error) {
          console.error(`❌ Error copying artifact ${full}:`, error.message);
          skippedCount++;
        }
      }
    }
  };

  if (fs.existsSync(abiSourceDir)) {
    walkAndCopy(abiSourceDir);
  } else {
    console.warn('⚠️  ABI source directory not found:', abiSourceDir);
  }

  // === 4. Write MockContracts.json with deployed mock addresses and factory + sample created contract ===
  console.log("💾 Writing MockContracts.json for frontend...");

  // create a sample rent contract via factory to demonstrate flow
  try {
  const tx = await contractFactory.createRentContract(tenant.address, ethers.parseUnits("1", 18), mockPriceAddress, 0);
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
