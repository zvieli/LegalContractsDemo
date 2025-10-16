// --- COPY ABI JSON FILES FROM ARTIFACTS TO FRONTEND ---
function copyAbisToFrontend() {
  const artifactsDir = path.join(__dirname, '../artifacts/contracts');
  const frontendDir = path.join(__dirname, '../front/src/utils/contracts');
  if (!fs.existsSync(frontendDir)) {
    fs.mkdirSync(frontendDir, { recursive: true });
  }
  // Recursively find all .json files in artifactsDir
  function findJsonFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findJsonFiles(filePath));
      } else if (file.endsWith('.json')) {
        results.push(filePath);
      }
    }
    return results;
  }
  const jsonFiles = findJsonFiles(artifactsDir);
  for (const srcPath of jsonFiles) {
    // Only copy ABI files for top-level contracts (skip debug/build-info)
    const fileName = path.basename(srcPath);
    // Use contract name as file name (e.g., ContractFactory.json)
    // Only copy if fileName matches a contract (not .dbg.json etc)
    if (!fileName.endsWith('.dbg.json') && !fileName.endsWith('.t.json')) {
      const destPath = path.join(frontendDir, fileName);
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log('Copied ABI JSON files to frontend ABI directory.');
}

// --- AUTO-GENERATE abisIndex.json FOR FRONTEND ABI LOADING ---
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateAbisIndex() {
  const contractsDir = path.join(__dirname, '../front/src/utils/contracts');
  const abisIndexPath = path.join(contractsDir, 'abisIndex.json');
  // Ensure directory exists
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }
  const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json') && f !== 'abisIndex.json' && f !== 'deployment-summary.json');
  const index = {};
  for (const file of files) {
    const name = file.replace('.json', '');
    index[name] = `/utils/contracts/${file}`;
  }
  fs.writeFileSync(abisIndexPath, JSON.stringify(index, null, 2));
  console.log('Generated abisIndex.json for frontend ABI loading.');
}

copyAbisToFrontend();
generateAbisIndex();
import "dotenv/config";
import pkg from "hardhat";

const { ethers, network } = pkg;

async function main() {
  console.log("🚀 Starting Unified V7 + Merkle Evidence Deployment...");
  console.log("DEBUG: Starting main()...");

  console.log("DEBUG: Getting signers...");
  const [deployer, tenant] = await ethers.getSigners();
  console.log("📝 Deploying with deployer:", deployer.address, " tenant:", tenant.address);

  console.log("DEBUG: Ensuring frontend directories exist...");
  const frontendContractsDir = path.resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts');
  try {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  } catch (e) {
    console.error('❌ Could not create frontend directory:', e.message || e);
    throw e;
  }

  console.log("\n📦 Deploying Core Infrastructure...");
  console.log("DEBUG: Deploying MerkleEvidenceManager...");
  const MerkleEvidenceManager = await ethers.getContractFactory('MerkleEvidenceManager');
  const merkleEvidenceManager = await MerkleEvidenceManager.deploy();
  await merkleEvidenceManager.waitForDeployment();
  const merkleAddress = await merkleEvidenceManager.getAddress();
  console.log("✅ MerkleEvidenceManager deployed to:", merkleAddress);
  console.log("DEBUG: MerkleEvidenceManager deployed.");

  console.log("DEBUG: Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();
  console.log("✅ ContractFactory deployed to:", factoryAddress);
  console.log("DEBUG: ContractFactory deployed.");

  console.log("DEBUG: Deploying ArbitrationService...");
  const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
  const arbitrationService = await ArbitrationService.deploy();
  await arbitrationService.waitForDeployment();
  const arbitrationServiceAddress = await arbitrationService.getAddress();
  console.log("✅ ArbitrationService deployed to:", arbitrationServiceAddress);
  console.log("DEBUG: ArbitrationService deployed.");

  console.log("DEBUG: Deploying RecipientKeyRegistry...");
  const RecipientKeyRegistry = await ethers.getContractFactory("RecipientKeyRegistry");
  const keyRegistry = await RecipientKeyRegistry.deploy();
  await keyRegistry.waitForDeployment();
  const keyRegistryAddress = await keyRegistry.getAddress();
  console.log("✅ RecipientKeyRegistry deployed to:", keyRegistryAddress);
  console.log("DEBUG: RecipientKeyRegistry deployed.");

  console.log("DEBUG: Deploying Arbitrator Oracle...");
  const Arbitrator = await ethers.getContractFactory("Arbitrator");
  const arbitrator = await Arbitrator.deploy(arbitrationServiceAddress);
  await arbitrator.waitForDeployment();
  const arbitratorAddress = await arbitrator.getAddress();
  console.log("✅ Arbitrator deployed to:", arbitratorAddress);
  console.log("DEBUG: Arbitrator deployed.");

  // === Deploy EnhancedRentContract ===
  console.log("DEBUG: Deploying EnhancedRentContract...");
  const EnhancedRentContract = await ethers.getContractFactory("EnhancedRentContract");
  // Use deployer as landlord, tenant as tenant, and reasonable defaults for other params
  const rentAmount = ethers.parseEther("1.0");
  const priceFeed = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
  const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days from now
  const propertyId = 1;
  const enhancedRentContract = await EnhancedRentContract.deploy(
    deployer.address, // landlord
    tenant.address,   // tenant
    rentAmount,
    priceFeed,
    dueDate,
    propertyId,
    arbitrationServiceAddress,
    merkleAddress
  );
  await enhancedRentContract.waitForDeployment();
  const enhancedRentContractAddress = await enhancedRentContract.getAddress();
  console.log("✅ EnhancedRentContract deployed to:", enhancedRentContractAddress);

  // === CCIP Oracle Arbitration Integration ===
  console.log("DEBUG: Deploying CCIP Oracle Arbitration system...");
  
  // Mainnet CCIP addresses (available on fork)
  const MAINNET_CCIP_ROUTER = "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D";
  const MAINNET_LINK_TOKEN = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
  const FORK_CHAIN_SELECTOR = "31337"; // Our local fork chain ID
  
  // Verify CCIP Router exists on fork
  const routerCode = await ethers.provider.getCode(MAINNET_CCIP_ROUTER);
  if (routerCode === "0x") {
    throw new Error("CCIP Router not found on fork. Are we connected to mainnet fork?");
  }
  console.log("✅ CCIP Router verified on mainnet fork");
  
  let ccipSenderAddress = null;
  let ccipReceiverAddress = null;
  
  try {
    console.log("📤 Deploying CCIPArbitrationSender...");
    const CCIPArbitrationSender = await ethers.getContractFactory("CCIPArbitrationSender");
    const ccipSender = await CCIPArbitrationSender.deploy(
      MAINNET_CCIP_ROUTER,
      MAINNET_LINK_TOKEN,
      FORK_CHAIN_SELECTOR,
      deployer.address // Use deployer as initial receiver for testing
    );
    await ccipSender.waitForDeployment();
    ccipSenderAddress = await ccipSender.getAddress();
    console.log("✅ CCIPArbitrationSender deployed to:", ccipSenderAddress);

    console.log("📥 Deploying CCIPArbitrationReceiver...");
    const CCIPArbitrationReceiver = await ethers.getContractFactory("CCIPArbitrationReceiver");
    const ccipReceiver = await CCIPArbitrationReceiver.deploy(
      MAINNET_CCIP_ROUTER,
      arbitrationServiceAddress
    );
    await ccipReceiver.waitForDeployment();
    ccipReceiverAddress = await ccipReceiver.getAddress();
    console.log("✅ CCIPArbitrationReceiver deployed to:", ccipReceiverAddress);

    // Configure CCIP authorizations
    console.log("🔑 Setting up CCIP authorizations...");
    
    // Authorize receiver to call ArbitrationService
    const authTx = await arbitrationService.authorizeCCIPReceiver(ccipReceiverAddress, true);
    await authTx.wait();
    console.log("✅ Authorized CCIP receiver in ArbitrationService");

    // Configure sender with receiver
    const configTx = await ccipSender.updateOracleConfig(FORK_CHAIN_SELECTOR, ccipReceiverAddress);
    await configTx.wait();
    console.log("✅ Configured Oracle in CCIP sender");

    // Check LINK balance and mint if needed (fork allows this)
    const linkToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"],
      MAINNET_LINK_TOKEN
    );
    const linkBalance = await linkToken.balanceOf(deployer.address);
    console.log("🔗 LINK Balance:", ethers.formatEther(linkBalance), "LINK");
    
    // On mainnet fork, we can simulate having LINK by impersonating a whale
    if (linkBalance < ethers.parseEther("10")) {
      console.log("💰 Simulating LINK transfer from whale account...");
      try {
        // Impersonate a whale account that has LINK
        const whaleAddress = "0x98C63b7B319dFBDF3d811530F2ab9DcE4983B9cD"; // Binance wallet with lots of LINK
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [whaleAddress]
        });
        
        const whale = await ethers.getSigner(whaleAddress);
        const whaleBalance = await linkToken.balanceOf(whaleAddress);
        
        if (whaleBalance > ethers.parseEther("100")) {
          await linkToken.connect(whale).transfer(deployer.address, ethers.parseEther("100"));
          console.log("✅ Transferred 100 LINK from whale to deployer");
        }
        
        await network.provider.request({
          method: "hardhat_stopImpersonatingAccount", 
          params: [whaleAddress]
        });
      } catch (e) {
        console.log("⚠️ Could not simulate LINK transfer:", e.message);
      }
    }
    
    console.log("✅ CCIP Oracle Arbitration system deployed successfully!");

  } catch (error) {
    console.warn("⚠️ CCIP deployment failed (continuing without Oracle):", error.message);
    console.log("💡 Contracts will work in traditional arbitration mode");
  }

  // Deploy ArbitrationContractV2 with real Chainlink Functions Router address
  const chainlinkRouter = '0x65Dcc24F8ff9e51F10DCc7Ed1e4e2A61e6E14bd6';
  const ArbitrationContractV2 = await ethers.getContractFactory('ArbitrationContractV2');
  const arbitrationContractV2 = await ArbitrationContractV2.deploy(arbitrationServiceAddress, chainlinkRouter);
  await arbitrationContractV2.waitForDeployment();
  const arbitrationContractV2Address = await arbitrationContractV2.getAddress();
  console.log('✅ ArbitrationContractV2 deployed to:', arbitrationContractV2Address);

  console.log("DEBUG: All contracts deployed. Starting configuration...");
  console.log("\n🔧 Configuring Contracts...");

  console.log("DEBUG: Setting default arbitration service in factory...");
  try {
    await contractFactory.setDefaultArbitrationService(arbitrationServiceAddress);
    console.log("✅ Factory configured with ArbitrationService");
  } catch (e) {
    console.warn("⚠️ Could not set arbitration service in factory:", e.message);
  }

  console.log("DEBUG: Setting Merkle evidence manager in factory...");
  try {
    await contractFactory.setMerkleEvidenceManager(merkleAddress);
    console.log("✅ Factory configured with MerkleEvidenceManager");
  } catch (e) {
    console.warn("⚠️ Could not set Merkle evidence manager in factory:", e.message);
  }

  console.log("DEBUG: Configuring ArbitrationService...");
  try {
    await arbitrationService.setFactory(arbitratorAddress);
    console.log("✅ ArbitrationService configured with Arbitrator");
  } catch (e) {
    console.warn("⚠️ Could not configure ArbitrationService:", e.message);
  }

  console.log("DEBUG: Contracts configured. Setting up price feed...");
  console.log("\n🔗 Setting up Chainlink Price Feed...");
  let priceFeedAddress;
  if (network.name === "mainnet" || network.name === "hardhat" || network.name === "localhost") {
    priceFeedAddress = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
    console.log(`✅ Using Chainlink price feed: ${priceFeedAddress}`);
  } else if (network.name === "sepolia") {
    priceFeedAddress = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
    console.log(`✅ Using Chainlink price feed: ${priceFeedAddress}`);
  } else {
    throw new Error("Unsupported network for price feed. Use mainnet, hardhat fork, sepolia, or localhost.");
  }

  // === 4. Test Merkle Evidence System ===
  console.log("\n🧪 Testing Merkle Evidence System...");
  
  const testBatch = {
    evidenceItems: [
      {
        caseId: 1,
        contentDigest: ethers.keccak256(ethers.toUtf8Bytes('Test evidence content')),
        cidHash: ethers.keccak256(ethers.toUtf8Bytes('QmTestCID123')),
        uploader: deployer.address,
        timestamp: Math.floor(Date.now() / 1000)
      }
    ]
  };

  // Encode evidence items for Merkle tree
  const leaves = testBatch.evidenceItems.map(item => {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes32', 'address', 'uint256'],
      [item.caseId, item.contentDigest, item.cidHash, item.uploader, item.timestamp]
    );
    return ethers.keccak256(encoded);
  });

  const merkleRoot = leaves[0]; // Single item root
  
  // Submit test batch
  const batchTx = await merkleEvidenceManager.submitEvidenceBatch(merkleRoot, 1);
  const batchReceipt = await batchTx.wait();
  
  const batchEvent = batchReceipt.logs.find(log => 
    log.fragment && log.fragment.name === 'BatchCreated'
  );
  const batchId = batchEvent.args.batchId;
  console.log(`✅ Test batch submitted (ID: ${batchId}, Gas: ${batchReceipt.gasUsed})`);

  // === 5. Sanity Checks ===
  console.log("\n🔍 Running Sanity Checks...");
  
  try {
    const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const factoryCode = await provider.getCode(factoryAddress);
    const merkleCode = await provider.getCode(merkleAddress);
    
    if (!factoryCode || factoryCode === '0x') {
      throw new Error(`No contract code at factory address ${factoryAddress}`);
    }
    if (!merkleCode || merkleCode === '0x') {
      throw new Error(`No contract code at Merkle manager address ${merkleAddress}`);
    }
    
    console.log(`✅ Factory code: ${factoryCode.length / 2} bytes`);
    console.log(`✅ Merkle manager code: ${merkleCode.length / 2} bytes`);
  } catch (err) {
    console.error('❌ Sanity check failed:', err.message);
    throw err;
  }

  // === 6. Save Deployment Data ===
  console.log("\n💾 Saving Deployment Data...");

  const deploymentData = {
    network: network.name,
    chainId: network.config?.chainId || 31337,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    priceFeed: priceFeedAddress,
    contracts: {
      ContractFactory: factoryAddress,
      MerkleEvidenceManager: merkleAddress,
      ArbitrationService: arbitrationServiceAddress,
      RecipientKeyRegistry: keyRegistryAddress,
      Arbitrator: arbitratorAddress,
      EnhancedRentContract: enhancedRentContractAddress
    },
    ccip: {
      enabled: ccipSenderAddress && ccipReceiverAddress,
      router: "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
      linkToken: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
      chainSelector: "31337",
      contracts: {
        CCIPArbitrationSender: ccipSenderAddress,
        CCIPArbitrationReceiver: ccipReceiverAddress
      }
    }
  };

  // Write main deployment file
  const deploymentFile = path.join(frontendContractsDir, "deployment-summary.json");
  try {
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log("✅ Deployment summary saved:", deploymentFile);
  } catch (e) {
    console.error('❌ Could not write deployment summary:', e.message);
    throw e;
  }

  // === 7. Copy Contract ABIs ===
  console.log("\n📋 Copying Contract ABIs...");

  const abiSourceDir = path.resolve(__dirname, '..', 'artifacts', 'contracts');
  let copiedCount = 0;
  let skippedCount = 0;

  const walkAndCopy = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walkAndCopy(full);
      } else if (ent.isFile() && ent.name.endsWith('.json')) {
        // Skip debug files, test contracts, and artifacts from test directories
        if (full.includes(`${path.sep}testing${path.sep}`) || 
            full.includes(`${path.sep}test-mocks${path.sep}`) || 
            ent.name.endsWith('.dbg.json')) {
          skippedCount++;
          continue;
        }

        try {
          const artifact = JSON.parse(fs.readFileSync(full, 'utf8'));
          
          // Skip test contracts by name
          if (artifact.contractName && /test/i.test(artifact.contractName)) {
            skippedCount++;
            continue;
          }

          const contractName = artifact.contractName || path.basename(ent.name, '.json');
          
          // Skip artifacts with no ABI (interfaces/abstracts)
          if (!artifact.abi || !Array.isArray(artifact.abi) || artifact.abi.length === 0) {
            skippedCount++;
            continue;
          }

          const chosenBytecode = (artifact.bytecode && artifact.bytecode.length > 2)
            ? artifact.bytecode
            : (artifact.deployedBytecode && artifact.deployedBytecode.length > 2)
              ? artifact.deployedBytecode
              : null;

          const abiData = {
            abi: artifact.abi || [],
            contractName: contractName,
            bytecode: chosenBytecode,
          };

                  // Save only to src/utils/contracts
                  const srcDest = path.join(frontendContractsDir, `${contractName}.json`);
                  fs.writeFileSync(srcDest, JSON.stringify(abiData, null, 2));
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
    console.log(`📋 Copied ${copiedCount} ABI files`);
    if (skippedCount > 0) {
      console.log(`⚠️ Skipped ${skippedCount} artifacts`);
    }
  } else {
    console.warn('⚠️ ABI source directory not found:', abiSourceDir);
    console.warn('⚠️ Make sure you ran `npx hardhat compile` first');
  }

  // === 8. Final Summary ===
  console.log("\n🎉 Unified Deployment Completed Successfully!");
  console.log("\n📋 Deployment Summary:");
  console.log(`   Network: ${network.name}`);
  console.log(`   Chain ID: ${network.config?.chainId || 31337}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Price Feed: ${priceFeedAddress}`);
  console.log("\n📦 Deployed Contracts:");
  console.log(`   ContractFactory: ${factoryAddress}`);
  console.log(`   MerkleEvidenceManager: ${merkleAddress}`);
  console.log(`   ArbitrationService: ${arbitrationServiceAddress}`);
  console.log(`   RecipientKeyRegistry: ${keyRegistryAddress}`);
  console.log(`   Arbitrator: ${arbitratorAddress}`);
  
  if (ccipSenderAddress && ccipReceiverAddress) {
    console.log("\n🔗 CCIP Oracle Arbitration:");
    console.log(`   CCIPArbitrationSender: ${ccipSenderAddress}`);
    console.log(`   CCIPArbitrationReceiver: ${ccipReceiverAddress}`);
    
    // Update server .env file automatically
    try {
      const serverEnvPath = path.resolve(__dirname, '..', 'server', '.env');
      let serverEnv = fs.readFileSync(serverEnvPath, 'utf8');
      
      // Update CCIP addresses
      serverEnv = serverEnv.replace(/CCIP_SENDER_ADDRESS=.*/g, `CCIP_SENDER_ADDRESS=${ccipSenderAddress}`);
      serverEnv = serverEnv.replace(/CCIP_RECEIVER_ADDRESS=.*/g, `CCIP_RECEIVER_ADDRESS=${ccipReceiverAddress}`);
      serverEnv = serverEnv.replace(/ARBITRATION_SERVICE_ADDRESS=.*/g, `ARBITRATION_SERVICE_ADDRESS=${arbitrationServiceAddress}`);
      
      fs.writeFileSync(serverEnvPath, serverEnv);
      console.log("✅ Updated server/.env with new contract addresses");
    } catch (e) {
      console.warn("⚠️ Could not update server/.env:", e.message);
    }
    console.log(`   CCIP Router: 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D`);
    console.log(`   LINK Token: 0x514910771AF9Ca656af840dff83E8264EcF986CA`);
  }
  
  console.log("\n💡 Gas Efficiency (Merkle Evidence):");
  console.log(`   Traditional evidence: ~79,000 gas each`);
  console.log(`   Batch submission: ~140k gas for unlimited items`);
  console.log(`   Savings: Up to 96% for large batches`);
  
  if (ccipSenderAddress) {
    console.log("\n🤖 Oracle Arbitration (NEW!):");
    console.log(`   CCIP Oracle: Enabled with Mainnet CCIP Router`);
    console.log(`   Automatic: Reports trigger Oracle arbitration`);
    console.log(`   LLM Powered: Uses Ollama for evidence analysis`);
    console.log(`   Zero Cost: Educational mode with CCIP Local Simulator`);
  }
  
  console.log("\n🔧 Usage Instructions:");
  console.log("   1. Use factory.createEnhancedRentContract() for all rent contracts (TemplateRentContract is deprecated)");
  console.log("   2. Batch evidence off-chain using MerkleEvidenceHelper");
  console.log("   3. Submit batches via MerkleEvidenceManager");

  if (ccipSenderAddress) {
    console.log("   4. Configure CCIP in templates: contract.configureCCIP('" + ccipSenderAddress + "', true)");
    console.log("   5. Start V7 backend: npm run start:v7 in server/");
    console.log("   6. Report disputes to trigger automatic Oracle arbitration");
  }
  console.log(`\n📁 Files saved to: ${frontendContractsDir}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});