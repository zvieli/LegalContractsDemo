import "dotenv/config";
import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CREATE DIRECTORIES IF THEY DON'T EXIST ---
function ensureDirectoriesExist() {
  console.log("\n📁 Ensuring all directories exist...");
  
  const directories = [
    path.join(__dirname, '../front/src/utils/contracts'),
    path.join(__dirname, '../server/config'),
    path.join(__dirname, '../server/config/contracts')
  ];

  let createdCount = 0;
  let existingCount = 0;

  for (const dir of directories) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
        createdCount++;
      } else {
        existingCount++;
      }
    } catch (error) {
      console.error(`❌ Failed to create directory ${dir}:`, error.message);
    }
  }

  console.log(`📁 Directories: ${createdCount} created, ${existingCount} already existed`);
}

// --- COPY ABI JSON FILES FROM ARTIFACTS TO FRONTEND ---
function copyAbisToFrontend() {
  console.log("\n📋 Starting ABI copy process...");
  
  ensureDirectoriesExist();

  const artifactsDir = path.join(__dirname, '../artifacts/contracts');
  const frontendDir = path.join(__dirname, '../front/src/utils/contracts');
  const serverDir = path.join(__dirname, '../server/config');
  const serverContractsDir = path.join(__dirname, '../server/config/contracts');

  [frontendDir, serverDir, serverContractsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  });

  function findJsonFiles(dir) {
    let results = [];
    try {
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
    } catch (error) {
      console.error(`❌ Error reading directory ${dir}:`, error.message);
    }
    return results;
  }

  const jsonFiles = findJsonFiles(artifactsDir);
  let copiedCount = 0;
  let errorCount = 0;

  console.log(`📁 Found ${jsonFiles.length} JSON files in artifacts`);

  for (const srcPath of jsonFiles) {
    const fileName = path.basename(srcPath);
    
    if (fileName.endsWith('.dbg.json') || fileName.endsWith('.t.json') || fileName.includes('.test.')) {
      continue;
    }

    try {
      const destFrontendPath = path.join(frontendDir, fileName);
      const destServerPath = path.join(serverContractsDir, fileName);
      
      fs.copyFileSync(srcPath, destFrontendPath);
      fs.copyFileSync(srcPath, destServerPath);
      
      copiedCount++;
    } catch (error) {
      console.error(`❌ Error copying ${fileName}:`, error.message);
      errorCount++;
    }
  }

  console.log(`✅ Successfully copied ${copiedCount} ABI files`);
  if (errorCount > 0) {
    console.log(`⚠️ Failed to copy ${errorCount} files`);
  }
}

// --- AUTO-GENERATE abisIndex.json FOR FRONTEND ABI LOADING ---
function generateAbisIndex() {
  console.log("\n📄 Generating ABI index...");
  
  const contractsDir = path.join(__dirname, '../front/src/utils/contracts');
  
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
    console.log(`✅ Created directory: ${contractsDir}`);
  }
  
  const abisIndexPath = path.join(contractsDir, 'abisIndex.json');
  
  let files = [];
  try {
    files = fs.readdirSync(contractsDir).filter(f => 
      f.endsWith('.json') && 
      f !== 'abisIndex.json' && 
      f !== 'deployment-summary.json' &&
      !f.includes('.test.')
    );
  } catch (error) {
    console.error('❌ Error reading contracts directory:', error.message);
    return;
  }
  
  const index = {};
  for (const file of files) {
    const name = file.replace('.json', '');
    index[name] = `/utils/contracts/${file}`;
  }
  
  try {
    fs.writeFileSync(abisIndexPath, JSON.stringify(index, null, 2));
    console.log(`✅ Generated abisIndex.json with ${Object.keys(index).length} entries`);
  } catch (error) {
    console.error('❌ Error writing abisIndex.json:', error.message);
  }
}

// --- WALK AND COPY ABI FUNCTION ---
function walkAndCopyAbis() {
  console.log("\n📋 Copying detailed ABI files...");
  
  const abiSourceDir = path.resolve(__dirname, '..', 'artifacts', 'contracts');
  const frontendContractsDir = path.resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts');
  
  [frontendContractsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  });

  let copiedCount = 0;
  let skippedCount = 0;

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        
        if (ent.isDirectory()) {
          walk(full);
        } else if (ent.isFile() && ent.name.endsWith('.json')) {
          if (full.includes(`${path.sep}testing${path.sep}`) || 
              full.includes(`${path.sep}test-mocks${path.sep}`) || 
              ent.name.endsWith('.dbg.json') ||
              ent.name.includes('.test.')) {
            skippedCount++;
            continue;
          }

          try {
            const artifact = JSON.parse(fs.readFileSync(full, 'utf8'));
            
            if (artifact.contractName && /test/i.test(artifact.contractName)) {
              skippedCount++;
              continue;
            }

            const contractName = artifact.contractName || path.basename(ent.name, '.json');
            
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

            const srcDest = path.join(frontendContractsDir, `${contractName}.json`);
            fs.writeFileSync(srcDest, JSON.stringify(abiData, null, 2));
            console.log(`✅ Copied ${contractName} ABI`);
            copiedCount++;
          } catch (error) {
            console.error(`❌ Error processing artifact ${full}:`, error.message);
            skippedCount++;
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error walking directory ${dir}:`, error.message);
    }
  }

  if (fs.existsSync(abiSourceDir)) {
    walk(abiSourceDir);
    console.log(`📋 Copied ${copiedCount} detailed ABI files`);
    if (skippedCount > 0) {
      console.log(`⚠️ Skipped ${skippedCount} artifacts`);
    }
  } else {
    console.warn('⚠️ ABI source directory not found:', abiSourceDir);
    console.warn('💡 Make sure you ran "npx hardhat compile" first');
  }
}

// --- WRITE PER-CONTRACT SERVER CONFIG FILES (address + abi) ---
function writePerContractServerConfigs(deploymentData) {
  try {
    console.log('\n📦 Writing per-contract server config files...');

    const serverConfigDir = path.resolve(__dirname, '..', 'server', 'config');
    const serverContractsDir = path.resolve(__dirname, '..', 'server', 'config', 'contracts');
    const frontendContractsDir = path.resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts');

    if (!fs.existsSync(serverConfigDir)) fs.mkdirSync(serverConfigDir, { recursive: true });

    const contracts = deploymentData.contracts || {};

    for (const [name, value] of Object.entries(contracts)) {
      let address = null;
      if (typeof value === 'string') address = value;
      else if (value && typeof value === 'object' && value.address) address = value.address;

      // normalize contract name (artifact files may include contractName or different casing)
      const candidateNames = [name, `${name}.json`, `${name}Contract`, `${name}Manager`];

      let abi = null;

      // Try serverContractsDir raw artifacts first
      for (const cand of candidateNames) {
        const p = path.join(serverContractsDir, cand.endsWith('.json') ? cand : `${cand}.json`);
        if (fs.existsSync(p)) {
          try {
            const art = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (art.abi && Array.isArray(art.abi)) {
              abi = art.abi;
              break;
            }
            // fallback: if artifact wrapped by 'abi' field deeper
            if (art.contractName && art.abi) {
              abi = art.abi;
              break;
            }
          } catch (e) {
            // ignore and continue
          }
        }
      }

      // Try frontendContractsDir processed ABI file
      if (!abi) {
        for (const cand of candidateNames) {
          const p = path.join(frontendContractsDir, cand.endsWith('.json') ? cand : `${cand}.json`);
          if (fs.existsSync(p)) {
            try {
              const art = JSON.parse(fs.readFileSync(p, 'utf8'));
              if (art.abi && Array.isArray(art.abi)) {
                abi = art.abi;
                break;
              }
              // some processed files store { abi: [], contractName }
              if (art.contractName && art.abi) {
                abi = art.abi;
                break;
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }

      const out = { address: address || null };
      if (abi) out.abi = abi;

      const outPath = path.join(serverConfigDir, `${name}.json`);
      try {
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
        console.log(`✅ Wrote server config for ${name}: ${outPath}`);
      } catch (err) {
        console.warn(`⚠️ Could not write server config for ${name}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('⚠️ Failed to write per-contract server configs:', err.message || err);
  }
}

// --- MAIN DEPLOYMENT FUNCTION ---
async function main() {
  console.log("🚀 Starting Unified V7 + Merkle Evidence Deployment...");
  
  ensureDirectoriesExist();
  
  console.log("DEBUG: Getting signers...");
  const [deployer, tenant] = await ethers.getSigners();
  console.log("📝 Deploying with deployer:", deployer.address, " tenant:", tenant.address);

  console.log("DEBUG: Ensuring frontend directories exist...");
  const frontendContractsDir = path.resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts');
  const serverConfigDir = path.resolve(__dirname, '..', 'server', 'config');
  
  try {
    [frontendContractsDir, serverConfigDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      }
    });
  } catch (e) {
    console.error('❌ Could not create directories:', e.message || e);
    throw e;
  }

  // === 1. Deploy Local Chainlink Mocks ===
  let mockV3Address = null;
  let mockLinkAddress = null;
  let mockRouterAddress = null;
  
  console.log('\n🧩 Deploying local Chainlink mocks...');

  const MockV3Aggregator = await ethers.getContractFactory('MockV3Aggregator');
  const initial = ethers.parseUnits('3000', 8);
  const mockV3 = await MockV3Aggregator.deploy(8, initial);
  await mockV3.waitForDeployment();
  mockV3Address = await mockV3.getAddress();
  console.log('✅ MockV3Aggregator deployed to:', mockV3Address);

  const MockLinkToken = await ethers.getContractFactory('MockLinkToken');
  const mockLink = await MockLinkToken.deploy(ethers.parseEther('1000000'));
  await mockLink.waitForDeployment();
  mockLinkAddress = await mockLink.getAddress();
  console.log('✅ MockLinkToken deployed to:', mockLinkAddress);

  const MockCCIPRouter = await ethers.getContractFactory('MockCCIPRouter');
  const mockRouter = await MockCCIPRouter.deploy(ethers.parseEther('0.001'));
  await mockRouter.waitForDeployment();
  mockRouterAddress = await mockRouter.getAddress();
  console.log('✅ MockCCIPRouter deployed to:', mockRouterAddress);

  // === 2. Deploy Core Infrastructure ===
  console.log("\n📦 Deploying Core Infrastructure...");
  
  console.log("DEBUG: Deploying MerkleEvidenceManager...");
  const MerkleEvidenceManager = await ethers.getContractFactory('MerkleEvidenceManager');
  const merkleEvidenceManager = await MerkleEvidenceManager.deploy();
  await merkleEvidenceManager.waitForDeployment();
  const merkleAddress = await merkleEvidenceManager.getAddress();
  console.log("✅ MerkleEvidenceManager deployed to:", merkleAddress);

  console.log("DEBUG: Deploying ContractFactory...");
  const ContractFactory = await ethers.getContractFactory("ContractFactory");
  const contractFactory = await ContractFactory.deploy();
  await contractFactory.waitForDeployment();
  const factoryAddress = await contractFactory.getAddress();
  console.log("✅ ContractFactory deployed to:", factoryAddress);

  console.log("DEBUG: Deploying ArbitrationService...");
  const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
  const arbitrationService = await ArbitrationService.deploy();
  await arbitrationService.waitForDeployment();
  const arbitrationServiceAddress = await arbitrationService.getAddress();
  console.log("✅ ArbitrationService deployed to:", arbitrationServiceAddress);

  console.log("DEBUG: Deploying RecipientKeyRegistry...");
  const RecipientKeyRegistry = await ethers.getContractFactory("RecipientKeyRegistry");
  const keyRegistry = await RecipientKeyRegistry.deploy();
  await keyRegistry.waitForDeployment();
  const keyRegistryAddress = await keyRegistry.getAddress();
  console.log("✅ RecipientKeyRegistry deployed to:", keyRegistryAddress);

  console.log("DEBUG: Deploying Arbitrator Oracle...");
  const Arbitrator = await ethers.getContractFactory("Arbitrator");
  const arbitrator = await Arbitrator.deploy(arbitrationServiceAddress);
  await arbitrator.waitForDeployment();
  const arbitratorAddress = await arbitrator.getAddress();
  console.log("✅ Arbitrator deployed to:", arbitratorAddress);

  console.log("DEBUG: Deploying EnhancedRentContract...");
  const EnhancedRentContract = await ethers.getContractFactory("EnhancedRentContract");
  const rentAmount = ethers.parseEther("1.0");
  // השתמש ב-Mock price feed במקום כתובת מייננט
  const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const propertyId = 1;
  const enhancedRentContract = await EnhancedRentContract.deploy(
    deployer.address,
    tenant.address,
    rentAmount,
    mockV3Address, // השתמש ב-Mock price feed
    dueDate,
    propertyId,
    arbitrationServiceAddress,
    merkleAddress
  );
  await enhancedRentContract.waitForDeployment();
  const enhancedRentContractAddress = await enhancedRentContract.getAddress();
  console.log("✅ EnhancedRentContract deployed to:", enhancedRentContractAddress);

  // === 3. CCIP Oracle Arbitration Integration ===
  console.log("DEBUG: Deploying CCIP Oracle Arbitration system...");
  
  const FORK_CHAIN_SELECTOR = '31337';
  // השתמש רק ב-Mock addresses - לא בכתובות מייננט
  let CCIP_ROUTER_ADDR = mockRouterAddress;
  let LINK_TOKEN_ADDR = mockLinkAddress;
  let ccipSenderAddress = null;
  let ccipReceiverAddress = null;

  const routerCode = await ethers.provider.getCode(CCIP_ROUTER_ADDR);
  if (!routerCode || routerCode === '0x') {
    console.warn('⚠️ CCIP Router not found; skipping CCIP deployment.');
  } else {
    try {
      console.log('📤 Deploying CCIPArbitrationSender...');
      const CCIPArbitrationSender = await ethers.getContractFactory('CCIPArbitrationSender');
      const ccipSender = await CCIPArbitrationSender.deploy(
        CCIP_ROUTER_ADDR,
        LINK_TOKEN_ADDR,
        FORK_CHAIN_SELECTOR,
        deployer.address
      );
      await ccipSender.waitForDeployment();
      ccipSenderAddress = await ccipSender.getAddress();
      console.log('✅ CCIPArbitrationSender deployed to:', ccipSenderAddress);

      console.log('📥 Deploying CCIPArbitrationReceiver...');
      const CCIPArbitrationReceiver = await ethers.getContractFactory('CCIPArbitrationReceiver');
      const ccipReceiver = await CCIPArbitrationReceiver.deploy(
        CCIP_ROUTER_ADDR,
        arbitrationServiceAddress
      );
      await ccipReceiver.waitForDeployment();
      ccipReceiverAddress = await ccipReceiver.getAddress();
      console.log('✅ CCIPArbitrationReceiver deployed to:', ccipReceiverAddress);

      console.log('🔑 Setting up CCIP authorizations...');
      const authTx = await arbitrationService.authorizeCCIPReceiver(ccipReceiverAddress, true);
      await authTx.wait();
      console.log('✅ Authorized CCIP receiver in ArbitrationService');

      const configTx = await ccipSender.updateOracleConfig(FORK_CHAIN_SELECTOR, ccipReceiverAddress);
      await configTx.wait();
      console.log('✅ Configured Oracle in CCIP sender');

      console.log('🔧 Minting and approving mock LINK for deployer...');
      const mockLinkContract = await ethers.getContractAt(['function mint(address,uint256)', 'function approve(address,uint256)'], mockLinkAddress);
      const mintTx = await mockLinkContract.mint(deployer.address, ethers.parseEther('100'));
      await mintTx.wait();
      const approveTx = await mockLinkContract.approve(ccipSenderAddress, ethers.parseEther('100'));
      await approveTx.wait();
      console.log('✅ Minted and approved mock LINK for deployer');

      console.log('✅ CCIP Oracle Arbitration system deployed successfully!');
    } catch (error) {
      console.warn('⚠️ CCIP deployment failed (continuing without Oracle):', error.message);
    }
  }

  // ArbitrationContractV2 - השתמש ב-Mock Router במקום Chainlink Functions
  const ArbitrationContractV2 = await ethers.getContractFactory('ArbitrationContractV2');
  const arbitrationContractV2 = await ArbitrationContractV2.deploy(arbitrationServiceAddress, mockRouterAddress);
  await arbitrationContractV2.waitForDeployment();
  const arbitrationContractV2Address = await arbitrationContractV2.getAddress();
  console.log('✅ ArbitrationContractV2 deployed to:', arbitrationContractV2Address);

  // === 4. Configure Contracts ===
  console.log("\n🔧 Configuring Contracts...");

  try {
    await contractFactory.setDefaultArbitrationService(arbitrationServiceAddress);
    console.log("✅ Factory configured with ArbitrationService");
  } catch (e) {
    console.warn("⚠️ Could not set arbitration service in factory:", e.message);
  }

  try {
    await contractFactory.setMerkleEvidenceManager(merkleAddress);
    console.log("✅ Factory configured with MerkleEvidenceManager");
  } catch (e) {
    console.warn("⚠️ Could not set Merkle evidence manager in factory:", e.message);
  }

  try {
    await arbitrationService.setFactory(arbitratorAddress);
    console.log("✅ ArbitrationService configured with Arbitrator");
  } catch (e) {
    console.warn("⚠️ Could not configure ArbitrationService:", e.message);
  }

  // === 5. Test Merkle Evidence System ===
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

  const leaves = testBatch.evidenceItems.map(item => {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes32', 'address', 'uint256'],
      [item.caseId, item.contentDigest, item.cidHash, item.uploader, item.timestamp]
    );
    return ethers.keccak256(encoded);
  });

  const merkleRoot = leaves[0];
  
  const batchTx = await merkleEvidenceManager.submitEvidenceBatch(merkleRoot, 1);
  const batchReceipt = await batchTx.wait();
  
  const batchEvent = batchReceipt.logs.find(log => 
    log.fragment && log.fragment.name === 'BatchCreated'
  );
  const batchId = batchEvent.args.batchId;
  console.log(`✅ Test batch submitted (ID: ${batchId}, Gas: ${batchReceipt.gasUsed})`);

  // === 6. Save Deployment Data ===
  console.log("\n💾 Saving Deployment Data...");

  const deploymentData = {
    network: network.name,
    chainId: network.config?.chainId || 31337,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    priceFeed: mockV3Address,
    contracts: {
      ContractFactory: factoryAddress,
      MerkleEvidenceManager: merkleAddress,
      ArbitrationService: arbitrationServiceAddress,
      RecipientKeyRegistry: keyRegistryAddress,
      Arbitrator: arbitratorAddress,
      EnhancedRentContract: enhancedRentContractAddress,
      ArbitrationContractV2: arbitrationContractV2Address,
      MockV3Aggregator: { address: mockV3Address },
      MockLinkToken: { address: mockLinkAddress },
      MockRouter: { address: mockRouterAddress }
    },
    ccip: {
      enabled: ccipSenderAddress && ccipReceiverAddress,
      router: mockRouterAddress,
      linkToken: mockLinkAddress,
      chainSelector: "31337",
      contracts: {
        CCIPArbitrationSender: ccipSenderAddress,
        CCIPArbitrationReceiver: ccipReceiverAddress
      }
    }
  };

  try {
    const blockNumber = await ethers.provider.getBlockNumber();
    deploymentData.fromBlock = Number(blockNumber);
  } catch (e) {
    console.warn('Could not determine blockNumber:', e.message || e);
  }

  const deploymentFile = path.join(frontendContractsDir, "deployment-summary.json");
  const backendDeploymentFile = path.join(__dirname, '../server/config/deployment-summary.json');
  
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log("✅ Deployment summary saved:", deploymentFile);
  
  fs.writeFileSync(backendDeploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log("✅ Deployment summary saved for backend:", backendDeploymentFile);

  // === 7. COPY ABIs - ONLY AFTER ALL DEPLOYMENTS ARE DONE ===
  console.log("\n📋 STARTING ABI COPY PROCESS");
  
  copyAbisToFrontend();
  generateAbisIndex();
  walkAndCopyAbis();

  console.log("\n✅ ALL ABI FILES COPIED SUCCESSFULLY!");

  // --- WRITE PER-CONTRACT SERVER CONFIGS (address + abi) ---
  writePerContractServerConfigs(deploymentData);

  // Update server .env file
  try {
    const serverEnvPath = path.resolve(__dirname, '..', 'server', '.env');
    let serverEnv = fs.readFileSync(serverEnvPath, 'utf8');
    
    serverEnv = serverEnv.replace(/CCIP_SENDER_ADDRESS=.*/g, `CCIP_SENDER_ADDRESS=${ccipSenderAddress || ''}`);
    serverEnv = serverEnv.replace(/CCIP_RECEIVER_ADDRESS=.*/g, `CCIP_RECEIVER_ADDRESS=${ccipReceiverAddress || ''}`);
    serverEnv = serverEnv.replace(/ARBITRATION_SERVICE_ADDRESS=.*/g, `ARBITRATION_SERVICE_ADDRESS=${arbitrationServiceAddress}`);
    
    fs.writeFileSync(serverEnvPath, serverEnv);
    console.log("✅ Updated server/.env with new contract addresses");
  } catch (e) {
    console.warn("⚠️ Could not update server/.env:", e.message);
  }

  // === 8. Final Summary ===
  console.log("\n🎉 Unified Deployment Completed Successfully!");
  console.log("\n📁 Created/Verified Directories:");
  console.log(`   Frontend: ${path.join(__dirname, '../front/src/utils/contracts')}`);
  console.log(`   Server: ${path.join(__dirname, '../server/config')}`);
  console.log(`   Server Contracts: ${path.join(__dirname, '../server/config/contracts')}`);
  console.log("\n📦 Deployed Contracts:");
  console.log(`   ContractFactory: ${factoryAddress}`);
  console.log(`   MerkleEvidenceManager: ${merkleAddress}`);
  console.log(`   ArbitrationService: ${arbitrationServiceAddress}`);
  console.log(`   RecipientKeyRegistry: ${keyRegistryAddress}`);
  console.log(`   Arbitrator: ${arbitratorAddress}`);
  console.log(`   EnhancedRentContract: ${enhancedRentContractAddress}`);
  console.log(`   MockV3Aggregator: ${mockV3Address}`);
  console.log(`   MockLinkToken: ${mockLinkAddress}`);
  console.log(`   MockRouter: ${mockRouterAddress}`);
  
  if (ccipSenderAddress && ccipReceiverAddress) {
    console.log("\n🔗 CCIP Oracle Arbitration:");
    console.log(`   CCIPArbitrationSender: ${ccipSenderAddress}`);
    console.log(`   CCIPArbitrationReceiver: ${ccipReceiverAddress}`);
  }
  
  console.log("\n💡 Gas Efficiency (Merkle Evidence):");
  console.log(`   Traditional evidence: ~79,000 gas each`);
  console.log(`   Batch submission: ~140k gas for unlimited items`);
  console.log(`   Savings: Up to 96% for large batches`);
  
  console.log("\n🔧 Usage Instructions:");
  console.log("   1. Use factory.createEnhancedRentContract() for all rent contracts");
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