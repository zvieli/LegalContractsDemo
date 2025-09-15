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

  // === 1.5 Optionally deploy mocks: MockERC20 and MockPriceFeed ===
  // By default we skip deploying mocks so local deployments can start minimal/empty.
  // Set DEPLOY_MOCKS=true in env to enable mock deployment.
  let mockTokenAddress = null;
  let mockPriceAddress = null;
  // Allow explicit override via DEPLOY_MOCKS env var. If not set, default to
  // deploying mocks on local networks to ensure frontend MockContracts.json
  // contains usable mock addresses for development.
  const envDeployMocks = process.env.DEPLOY_MOCKS;
  let deployMocks = String(envDeployMocks ?? '').toLowerCase() === 'true';
  if (typeof envDeployMocks === 'undefined') {
    const localNames = ['localhost', 'hardhat'];
    if (localNames.includes(network.name) || Number(process.env.CHAIN_ID) === 31337) {
      deployMocks = true;
      console.log('ℹ️  DEPLOY_MOCKS not set - defaulting to true on local network to populate MockContracts.json');
    }
  }

  // Ensure frontend contracts dir exists early so we can inspect existing MockContracts.json
  const frontendContractsDir = path.join(
    __dirname,
    "../front/src/utils/contracts"
  );
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }

  // If DEPLOY_MOCKS is not explicitly true, but the frontend MockContracts.json exists
  // and is missing mock addresses, auto-enable mock deployment so we populate the file.
  let shouldDeployMocks = deployMocks;
  try {
    const mockContractsPath = path.join(frontendContractsDir, "MockContracts.json");
    if (!deployMocks && fs.existsSync(mockContractsPath)) {
      const existing = JSON.parse(fs.readFileSync(mockContractsPath, 'utf8')) || {};
      const mp = existing?.contracts?.MockPriceFeed ?? null;
      const me = existing?.contracts?.MockERC20 ?? null;
      if (!mp || !me) {
        console.log('ℹ️  MockContracts.json missing mock addresses; enabling mock deployment to populate them');
        shouldDeployMocks = true;
      }
    }
  } catch (e) {
    console.warn('⚠️  Could not inspect existing MockContracts.json:', e.message || e);
  }

  if (shouldDeployMocks) {
    console.log("📦 Deploying mock tokens and price feed...");
    console.log("📦 Deploying mock tokens and price feed...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy("Mock Token", "MCK", ethers.parseUnits("1000000", 18));
    await mockToken.waitForDeployment();
    mockTokenAddress = await mockToken.getAddress();

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    // initial price 2000
    const mockPrice = await MockPriceFeed.deploy(2000);
    await mockPrice.waitForDeployment();
    mockPriceAddress = await mockPrice.getAddress();

    console.log("✅ MockERC20 deployed to:", mockTokenAddress);
    console.log("✅ MockPriceFeed deployed to:", mockPriceAddress);
  } else {
    console.log('ℹ️  Skipping mock deployments (set DEPLOY_MOCKS=true to enable)');
  }

  // === 2. Save deployment.json ===
  const deploymentData = {
    network: network.name,
    contracts: {
      ContractFactory: factoryAddress,
  // פה תוכל להוסיף חוזים נוספים אם תפרוס אותם
    },
  };

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

  // === 2.5 Optionally deploy ArbitrationService and configure factory ===
  // By default we skip deploying ArbitrationService. Set DEPLOY_ARBITRATION=true to enable.
  let arbitrationServiceAddress = null;
  const deployArbitration = String(process.env.DEPLOY_ARBITRATION || '').toLowerCase() === 'true';
  if (deployArbitration) {
    console.log("📦 Deploying ArbitrationService...");
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
      
      // Also merge the ArbitrationService address into MockContracts.json so the frontend
      // can automatically pick it up when using the local dev environment.
      try {
        const mockContractsPath = path.join(frontendContractsDir, "MockContracts.json");
        let existingMock = {};
        if (fs.existsSync(mockContractsPath)) {
          try { existingMock = JSON.parse(fs.readFileSync(mockContractsPath, 'utf8')) || {}; } catch (e) { existingMock = {}; }
        }
        existingMock.contracts = existingMock.contracts || {};
        existingMock.contracts.ArbitrationService = arbitrationServiceAddress;
        fs.writeFileSync(mockContractsPath, JSON.stringify(existingMock, null, 2));
        console.log('💾 Updated MockContracts.json with ArbitrationService address');
      } catch (err) {
        console.warn('⚠️  Could not update MockContracts.json with ArbitrationService address:', err.message || err);
      }
    } catch (err) {
      console.warn('⚠️  ArbitrationService deploy failed:', err.message || err);
    }
  } else {
    console.log('ℹ️  Skipping ArbitrationService deployment (set DEPLOY_ARBITRATION=true to enable)');
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

  // === 4. Write MockContracts.json with deployed mock addresses and factory (no sample/demo contract) ===
  console.log("💾 Writing MockContracts.json for frontend...");

  try {
    const mockContractsPath = path.join(frontendContractsDir, "MockContracts.json");
    let existing = {};
    if (fs.existsSync(mockContractsPath)) {
      try { existing = JSON.parse(fs.readFileSync(mockContractsPath, 'utf8')) || {}; } catch (e) { existing = {}; }
    }

    existing.contracts = existing.contracts || {};
    // Only set values that are available (null means not deployed)
    if (mockPriceAddress) existing.contracts.MockPriceFeed = mockPriceAddress;
    if (mockTokenAddress) existing.contracts.MockERC20 = mockTokenAddress;
    existing.contracts.ContractFactory = existing.contracts.ContractFactory || factoryAddress;

    fs.writeFileSync(mockContractsPath, JSON.stringify(existing, null, 2));
    console.log("✅ MockContracts.json written/updated to frontend:", mockContractsPath);
  } catch (err) {
    console.error("⚠️  Could not write MockContracts.json to frontend:", err.message);
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
