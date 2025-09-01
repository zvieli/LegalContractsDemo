import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function copyABI() {
  console.log('📂 Copying ABI files to frontend...');
  
  const abiSourceDir = path.join(__dirname, '../artifacts/contracts');
const abiDestDir = path.join(__dirname, '../legal-contracts-frontend/src/utils/abis');
  
  const contractsToCopy = [
    'ContractFactory.sol',
    'TemplateRentContract.sol', 
    'NDATemplate.sol',
    'Arbitrator.sol'
  ];
  
  if (!fs.existsSync(abiDestDir)) {
    fs.mkdirSync(abiDestDir, { recursive: true });
    console.log('✅ Created abis directory:', abiDestDir);
  }
  
  let copiedCount = 0;
  let skippedCount = 0;
  
  contractsToCopy.forEach(contractFile => {
    const contractName = contractFile.replace('.sol', '');
    const artifactPath = path.join(abiSourceDir, contractFile, `${contractName}.json`);
    
    if (fs.existsSync(artifactPath)) {
      try {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const abiData = {
          abi: artifact.abi,
          contractName: contractName,
          bytecode: artifact.bytecode
        };
        
        const destPath = path.join(abiDestDir, `${contractName}ABI.json`);
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
  
  console.log(`🎉 Copied ${copiedCount} ABI files to src/abis/`);
  if (skippedCount > 0) {
    console.log(`⚠️  Skipped ${skippedCount} contracts (not found)`);
  }
  
  return copiedCount;
}

// הרצה אם הקובץ נקרא ישירות
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = copyABI();
  process.exit(result > 0 ? 0 : 1);
}