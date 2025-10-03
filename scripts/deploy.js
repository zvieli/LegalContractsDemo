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

  // === 1.5 Optionally deploy mocks: MockPriceFeed ===
  // Mock ERC20 support removed from project. We only deploy MockPriceFeed when needed.
  let mockTokenAddress = null; // retained for compatibility but never set
  let mockPriceAddress = null;
  const envDeployMocks = process.env.DEPLOY_MOCKS;
  let deployMocks = String(envDeployMocks ?? '').toLowerCase() === 'true';
  if (typeof envDeployMocks === 'undefined') {
    const localNames = ['localhost', 'hardhat'];
    if (localNames.includes(network.name) || Number(process.env.CHAIN_ID) === 31337) {
      deployMocks = true;
      console.log('ℹ️  DEPLOY_MOCKS not set - defaulting to true on local network to populate MockContracts.json (price feed only)');
    }
  }

  // Ensure frontend public contracts dir exists early. The dev server serves
  // artifacts from `front/public/utils/contracts` at runtime (served at /utils/contracts/).
  // Resolve frontend public contracts dir robustly (use path.resolve to handle Windows paths)
  const frontendPublicContractsDir = path.resolve(__dirname, '..', 'front', 'public', 'utils', 'contracts');
  // Primary contracts directory used for runtime fetch
  const frontendContractsDir = frontendPublicContractsDir;
  try {
    fs.mkdirSync(frontendPublicContractsDir, { recursive: true });
  } catch (e) {
    console.error('❌ Could not create frontend public contracts directory:', frontendPublicContractsDir, e.message || e);
    throw e;
  }

  // If DEPLOY_MOCKS is not explicitly true, check both src and public MockContracts.json
  // and auto-enable mock deployment when the MockPriceFeed address is missing.
  let shouldDeployMocks = deployMocks;
  try {
    const checkPaths = [
      path.join(frontendPublicContractsDir, "MockContracts.json")
    ];
    for (const p of checkPaths) {
      if (!deployMocks && fs.existsSync(p)) {
        const existing = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
        const mp = existing?.contracts?.MockPriceFeed ?? null;
        if (!mp) {
          console.log('ℹ️  MockContracts.json missing MockPriceFeed address; enabling mock deployment to populate it');
          shouldDeployMocks = true;
          break;
        }
      }
    }
  } catch (e) {
    console.warn('⚠️  Could not inspect existing MockContracts.json:', e.message || e);
  }

  if (shouldDeployMocks) {
    console.log("📦 Deploying mock price feed...");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    // initial price 2000
    const mockPrice = await MockPriceFeed.deploy(2000);
    await mockPrice.waitForDeployment();
    mockPriceAddress = await mockPrice.getAddress();
    console.log("✅ MockPriceFeed deployed to:", mockPriceAddress);
  } else {
    console.log('ℹ️  Skipping mock price feed deployment (set DEPLOY_MOCKS=true to enable)');
  }

  // === 2. Save deployment.json ===
  const deploymentData = {
    network: network.name,
    contracts: {
      ContractFactory: factoryAddress,
  // פה תוכל להוסיף חוזים נוספים אם תפרוס אותם
    },
  };

  // Write ContractFactory.json to public (primary)
  const publicDeploymentFile = path.join(frontendPublicContractsDir, "ContractFactory.json");
  try {
    fs.writeFileSync(publicDeploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log("💾 Deployment saved to frontend public:", publicDeploymentFile);
  } catch (e) {
    console.error('❌ Could not write ContractFactory.json to frontend public:', publicDeploymentFile, e.message || e);
    throw e;
  }

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
  // However, for local development we auto-enable deployment when the frontend
  // doesn't already contain an ArbitrationService address so the UI can prefill it.
  let arbitrationServiceAddress = null;
  let deployArbitration = String(process.env.DEPLOY_ARBITRATION || '').toLowerCase() === 'true';

  // If DEPLOY_ARBITRATION not explicitly set, enable on local networks when missing
  // from the frontend MockContracts.json so the UI can pick it up automatically.
  if (typeof process.env.DEPLOY_ARBITRATION === 'undefined') {
    try {
      const localNames = ['localhost', 'hardhat'];
      if (localNames.includes(network.name) || Number(process.env.CHAIN_ID) === 31337) {
        const mockContractsPath = path.join(frontendContractsDir, "MockContracts.json");
        let existingMock = {};
        if (fs.existsSync(mockContractsPath)) {
          try { existingMock = JSON.parse(fs.readFileSync(mockContractsPath, 'utf8')) || {}; } catch (e) { existingMock = {}; }
        }
        const hasArb = !!(existingMock && existingMock.contracts && existingMock.contracts.ArbitrationService);
        if (!hasArb) {
          deployArbitration = true;
          console.log('ℹ️  DEPLOY_ARBITRATION not set - defaulting to true on local network to ensure ArbitrationService is available for the frontend');
        }
      }
    } catch (e) {
      console.warn('⚠️  Could not determine whether to auto-deploy ArbitrationService:', e.message || e);
    }
  }

  if (deployArbitration) {
    console.log("📦 Deploying ArbitrationService...");
    try {
      const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
      const arbitrationService = await ArbitrationService.deploy();
      await arbitrationService.waitForDeployment();
      arbitrationServiceAddress = await arbitrationService.getAddress();
      console.log("✅ ArbitrationService deployed to:", arbitrationServiceAddress);

      // Deploy ArbitrationContractV2 (Chainlink Functions client)
      console.log("📦 Deploying ArbitrationContractV2 (Chainlink Functions client)...");
      // For local development, we'll use a mock router address (zero address)
      // In production, use the actual Chainlink Functions router for your network
      const mockRouterAddress = "0x0000000000000000000000000000000000000000"; 
      const ArbitrationContractV2 = await ethers.getContractFactory("ArbitrationContractV2");
      const arbitrationContractV2 = await ArbitrationContractV2.deploy(arbitrationServiceAddress, mockRouterAddress);
      await arbitrationContractV2.waitForDeployment();
      const arbitrationContractV2Address = await arbitrationContractV2.getAddress();
      console.log("✅ ArbitrationContractV2 deployed to:", arbitrationContractV2Address);

      // Configure the ArbitrationService to trust the ArbitrationContractV2 as factory
      try {
        const tx2 = await arbitrationService.setFactory(arbitrationContractV2Address);
        await tx2.wait();
        console.log("🔧 ArbitrationService.factory set to ArbitrationContractV2:", arbitrationContractV2Address);
      } catch (err) {
        console.warn("⚠️  Could not set ArbitrationService.factory to ArbitrationContractV2:", err.message || err);
      }

      // Update the previously-written ContractFactory.json to include the service
      try {
        // Update the ContractFactory.json we wrote earlier (publicDeploymentFile)
        const deploymentFileContents = fs.readFileSync(publicDeploymentFile, 'utf8');
        const parsed = JSON.parse(deploymentFileContents);
        parsed.contracts = parsed.contracts || {};
        parsed.contracts.ArbitrationService = arbitrationServiceAddress;
        parsed.contracts.ArbitrationContractV2 = arbitrationContractV2Address;
        fs.writeFileSync(publicDeploymentFile, JSON.stringify(parsed, null, 2));
        console.log("💾 Updated ContractFactory.json with ArbitrationService and ArbitrationContractV2 addresses");
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
        existingMock.contracts.ArbitrationContractV2 = arbitrationContractV2Address;
        fs.writeFileSync(mockContractsPath, JSON.stringify(existingMock, null, 2));
        console.log('💾 Updated MockContracts.json with ArbitrationService and ArbitrationContractV2 addresses');
      } catch (err) {
        console.warn('⚠️  Could not update MockContracts.json with ArbitrationService address:', err.message || err);
      }
      // Configure factory default arbitration so newly created Rent contracts
      // receive the arbitrationService address at construction. This avoids
      // needing to call `setArbitrationService` on each template after deploy.
      try {
        const factoryInstance = await ethers.getContractAt('ContractFactory', factoryAddress, deployer);
        // Set factory default arbitration to the deployed service (owner only)
        try {
          const tx = await factoryInstance.setDefaultArbitrationService(arbitrationServiceAddress, 0);
          await tx.wait();
          console.log(`🔧 Set ContractFactory.defaultArbitrationService -> ${arbitrationServiceAddress}`);
        } catch (err) {
          console.warn('⚠️  Could not set default arbitration on factory (owner permissions?):', err.message || err);
        }
      } catch (err) {
        console.warn('⚠️  Could not connect to ContractFactory to set default arbitration:', err.message || err);
      }
    } catch (err) {
      console.warn('⚠️  ArbitrationService deploy failed:', err.message || err);
    }
  } else {
    console.log('ℹ️  Skipping ArbitrationService deployment (set DEPLOY_ARBITRATION=true to enable)');
    // If we're on localhost and the frontend lacks an ArbitrationService entry, write
    // a placeholder note so the frontend knows to prompt the developer clearly.
    try {
      const mockContractsPath = path.join(frontendContractsDir, "MockContracts.json");
      let existingMock = {};
      if (fs.existsSync(mockContractsPath)) {
        try { existingMock = JSON.parse(fs.readFileSync(mockContractsPath, 'utf8')) || {}; } catch (e) { existingMock = {}; }
      }
      existingMock.contracts = existingMock.contracts || {};
      if (!existingMock.contracts.ArbitrationService) {
        // Use a clear sentinel value so the frontend can detect and prompt the dev
        existingMock.contracts.ArbitrationService = "MISSING_ARBITRATION_SERVICE";
        fs.writeFileSync(mockContractsPath, JSON.stringify(existingMock, null, 2));
        console.log('💾 Wrote placeholder ArbitrationService=MISSING_ARBITRATION_SERVICE to MockContracts.json so frontend knows it is missing');
      }
    } catch (e) {
      console.warn('⚠️  Could not write placeholder ArbitrationService to MockContracts.json:', e.message || e);
    }
  }

  // OracleArbitratorFunctions deployment removed in sweep

  // === 3. Copy ABIs ===
  console.log("📂 Copying ABI files to frontend...");

  const abiSourceDir = path.resolve(__dirname, '..', 'artifacts', 'contracts');
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

          const publicDest = path.join(frontendPublicContractsDir, `${contractName}ABI.json`);
          fs.writeFileSync(publicDest, JSON.stringify(abiData, null, 2));
          console.log(`✅ Copied ${contractName} ABI to public`);
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
    console.warn('⚠️  Make sure you ran `npx hardhat compile` before deploying so artifacts exist.');
  }

  // === 4. Write MockContracts.json with deployed mock addresses and factory (no sample/demo contract) ===
  console.log("💾 Writing MockContracts.json for frontend...");

    try {
      // Write MockContracts.json to public (primary)
      const publicMockContractsPath = path.join(frontendPublicContractsDir, "MockContracts.json");
      let existing = {};
      if (fs.existsSync(publicMockContractsPath)) {
        try { existing = JSON.parse(fs.readFileSync(publicMockContractsPath, 'utf8')) || {}; } catch (e) { existing = {}; }
      }

      existing.contracts = existing.contracts || {};
      if (mockPriceAddress) existing.contracts.MockPriceFeed = mockPriceAddress;
      existing.contracts.ContractFactory = existing.contracts.ContractFactory || factoryAddress;

      fs.writeFileSync(publicMockContractsPath, JSON.stringify(existing, null, 2));
      console.log("✅ MockContracts.json written/updated to frontend public:", publicMockContractsPath);
      // Extra verification: print the file size and presence to help debugging when the frontend can't find it
      try {
        const stat = fs.statSync(publicMockContractsPath);
        console.log(`ℹ️  Wrote MockContracts.json (${stat.size} bytes)`);
      } catch (stErr) {
        // ignore
      }
    } catch (err) {
      console.error("⚠️  Could not write MockContracts.json to frontend:", err.message || err);
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
