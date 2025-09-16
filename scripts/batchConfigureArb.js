import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('Batch configure arbitration services (local only)');
  const frontendContractsDir = path.join(__dirname, '../front/src/utils/contracts');
  const mockPath = path.join(frontendContractsDir, 'MockContracts.json');
  let mc = {};
  if (fs.existsSync(mockPath)) {
    try { mc = JSON.parse(fs.readFileSync(mockPath, 'utf8')) || {}; } catch (_) { mc = {}; }
  }
  const arbAddr = mc?.contracts?.ArbitrationService || null;
  if (!arbAddr || arbAddr === 'MISSING_ARBITRATION_SERVICE') {
    console.error('No ArbitrationService configured in frontend artifacts. Run deploy with DEPLOY_ARBITRATION first.');
    process.exit(1);
  }

  // Get factory from frontend artifact
  const cfPath = path.join(frontendContractsDir, 'ContractFactory.json');
  if (!fs.existsSync(cfPath)) {
    console.error('ContractFactory.json missing in frontend artifacts');
    process.exit(1);
  }
  let cf = {};
  try { cf = JSON.parse(fs.readFileSync(cfPath, 'utf8')) || {}; } catch (_) { cf = {}; }
  const factoryAddr = cf?.contracts?.ContractFactory;
  if (!factoryAddr) {
    console.error('ContractFactory address not present in Artifact');
    process.exit(1);
  }

  const isLocal = ['localhost','hardhat'].includes(network.name) || Number(network.config.chainId) === 31337;
  if (!isLocal) {
    console.error('Refusing to run batch configure on non-local network');
    process.exit(1);
  }

  // Prefer to set the factory-level default arbitration so new contracts receive it
  try {
    const factory = await ethers.getContractAt('ContractFactory', factoryAddr);
    const tx = await factory.setDefaultArbitrationService(arbAddr, 0);
    await tx.wait();
    console.log(`Set factory default arbitration -> ${arbAddr}`);
  } catch (err) {
    console.warn('Could not set factory default arbitration directly (owner mismatch?). Falling back to owner impersonation.');
    try {
      const factory = await ethers.getContractAt('ContractFactory', factoryAddr);
      const owner = await factory.owner();
      console.log('Impersonating factory owner:', owner);
      await network.provider.request({ method: 'hardhat_impersonateAccount', params: [owner] });
      const signers = await ethers.getSigners();
      try { await signers[0].sendTransaction({ to: owner, value: ethers.parseEther('0.05') }); } catch (_) {}
      const imp = await ethers.getSigner(owner);
      const factoryImp = await ethers.getContractAt('ContractFactory', factoryAddr, imp);
      const tx = await factoryImp.setDefaultArbitrationService(arbAddr, 0);
      await tx.wait();
      console.log('Configured factory default arbitration via impersonation successfully.');
      await network.provider.request({ method: 'hardhat_stopImpersonatingAccount', params: [owner] });
    } catch (impErr) {
      console.warn('Fallback impersonation failed:', impErr.message || impErr);
    }
  }

  console.log('Batch configure complete');
}

main().catch((e) => { console.error(e); process.exit(1); });
