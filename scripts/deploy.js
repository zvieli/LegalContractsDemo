import "dotenv/config";
import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Starting Unified V7 + Merkle Evidence Deployment...");
  console.log("DEBUG: Starting main()...");

  console.log("DEBUG: Getting signers...");
  const [deployer, tenant] = await ethers.getSigners();
  console.log("📝 Deploying with deployer:", deployer.address, " tenant:", tenant.address);

  console.log("DEBUG: Ensuring frontend directories exist...");
  const frontendPublicContractsDir = path.resolve(__dirname, '..', 'front', 'public', 'utils', 'contracts');
  const frontendContractsDir = path.resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts');
  
  try {
    fs.mkdirSync(frontendPublicContractsDir, { recursive: true });
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  } catch (e) {
    console.error('❌ Could not create frontend directories:', e.message || e);
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

  console.log("DEBUG: All contracts deployed. Starting configuration...");
  console.log("\n🔧 Configuring Contracts...");

  console.log("DEBUG: Setting default arbitration service in factory...");
  try {
    await contractFactory.setDefaultArbitrationService(arbitrationServiceAddress, ethers.parseEther('0.5'));
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
  if (network.name === "mainnet" || network.name === "hardhat") {
    priceFeedAddress = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
    console.log(`✅ Using Chainlink price feed: ${priceFeedAddress}`);
  } else if (network.name === "sepolia") {
    priceFeedAddress = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
    console.log(`✅ Using Chainlink price feed: ${priceFeedAddress}`);
  } else {
    throw new Error("Unsupported network for price feed. Use mainnet, hardhat fork, or sepolia.");
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
      Arbitrator: arbitratorAddress
    }
  };

  // Write main deployment file
  const publicDeploymentFile = path.join(frontendPublicContractsDir, "deployment-summary.json");
  try {
    fs.writeFileSync(publicDeploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log("✅ Deployment summary saved:", publicDeploymentFile);
  } catch (e) {
    console.error('❌ Could not write deployment summary:', e.message);
    throw e;
  }

  // Write legacy ContractFactory.json for backward compatibility
  const legacyFactoryFile = path.join(frontendPublicContractsDir, "ContractFactory.json");
  try {
    const legacyData = {
      network: network.name,
      contracts: {
        ContractFactory: factoryAddress,
        ArbitrationService: arbitrationServiceAddress,
        RecipientKeyRegistry: keyRegistryAddress,
        MerkleEvidenceManager: merkleAddress,
        Arbitrator: arbitratorAddress
      }
    };
    fs.writeFileSync(legacyFactoryFile, JSON.stringify(legacyData, null, 2));
    console.log("✅ Legacy ContractFactory.json saved");
  } catch (e) {
    console.warn('⚠️ Could not write ContractFactory.json:', e.message);
  }

  // Write MockContracts.json for frontend
  const mockContractsFile = path.join(frontendPublicContractsDir, "MockContracts.json");
  try {
    const mockData = {
      network: network.name,
      contracts: {
        ContractFactory: factoryAddress,
        ArbitrationService: arbitrationServiceAddress,
        RecipientKeyRegistry: keyRegistryAddress,
        MerkleEvidenceManager: merkleAddress,
        Arbitrator: arbitratorAddress,
        // Keep price feed for reference
        ChainlinkPriceFeed: priceFeedAddress
      }
    };
    fs.writeFileSync(mockContractsFile, JSON.stringify(mockData, null, 2));
    console.log("✅ MockContracts.json saved");
  } catch (e) {
    console.warn('⚠️ Could not write MockContracts.json:', e.message);
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

          // Save to both directories for compatibility
          const publicDest = path.join(frontendPublicContractsDir, `${contractName}ABI.json`);
          const srcDest = path.join(frontendContractsDir, `${contractName}.json`);
          
          fs.writeFileSync(publicDest, JSON.stringify(abiData, null, 2));
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
  console.log("\n💡 Gas Efficiency (Merkle Evidence):");
  console.log(`   Traditional evidence: ~79,000 gas each`);
  console.log(`   Batch submission: ~140k gas for unlimited items`);
  console.log(`   Savings: Up to 96% for large batches`);
  console.log("\n🔧 Usage Instructions:");
  console.log("   1. Use factory.createEnhancedRentContract() for gas-optimized evidence");
  console.log("   2. Use factory.createRentContract() for traditional contracts");
  console.log("   3. Batch evidence off-chain using MerkleEvidenceHelper");
  console.log("   4. Submit batches via MerkleEvidenceManager");
  console.log(`\n📁 Files saved to: ${frontendPublicContractsDir}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});