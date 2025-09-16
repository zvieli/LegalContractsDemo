import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const target = process.env.TARGET || '0x881ba6B5CD479DA53d56ac18b3D8853Aa0fcCC07';
  console.log('Inspecting target:', target);

  const rent = await ethers.getContractAt('TemplateRentContract', target);
  const current = await rent.arbitrationService().catch(() => ethers.ZeroAddress);
  console.log('Current arbitrationService:', current);

  if (current && current !== ethers.ZeroAddress) {
    console.log('✅ Target already configured. Nothing to do.');
    return;
  }

  // Read frontend MockContracts.json to find a configured ArbitrationService
  const frontendContractsDir = path.join(__dirname, '../front/src/utils/contracts');
  const mockPath = path.join(frontendContractsDir, 'MockContracts.json');
  let mc = {};
  if (fs.existsSync(mockPath)) {
    try { mc = JSON.parse(fs.readFileSync(mockPath, 'utf8')) || {}; } catch (_) { mc = {}; }
  }
  const arbAddr = mc?.contracts?.ArbitrationService || null;
  if (!arbAddr || arbAddr === 'MISSING_ARBITRATION_SERVICE') {
    console.error('No ArbitrationService address available in frontend artifacts (MockContracts.json). Deploy one or update the file.');
    return process.exit(1);
  }
  console.log('Frontend arbitration service address:', arbAddr);

  // read landlord
  const landlord = await rent.landlord();
  console.log('Landlord for target:', landlord);

  // Only attempt impersonation on local hardhat/network
  const isLocal = ['localhost','hardhat'].includes(network.name) || Number(process.env.CHAIN_ID) === 31337 || Number(network.config.chainId) === 31337;
  if (!isLocal) {
    console.error('Refusing to impersonate on non-local network. Please call factory.setDefaultArbitrationService from the factory owner account.');
    return process.exit(1);
  }

  // Impersonate factory owner and set factory default arbitration so new contracts pick it up
  try {
    const frontendContractsDir = path.join(__dirname, '../front/src/utils/contracts');
    const factoryFile = path.join(frontendContractsDir, 'ContractFactory.json');
    if (!fs.existsSync(factoryFile)) {
      console.error('ContractFactory.json not found in frontend utils - cannot discover factory address to configure');
      return process.exit(1);
    }
    const parsed = JSON.parse(fs.readFileSync(factoryFile, 'utf8') || '{}');
    const factoryAddr = parsed?.contracts?.ContractFactory || null;
    if (!factoryAddr) {
      console.error('No ContractFactory address in ContractFactory.json');
      return process.exit(1);
    }

    const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    // Determine owner
    const factoryRead = await ethers.getContractAt('ContractFactory', factoryAddr);
    const owner = await factoryRead.owner().catch(() => null);
    if (!owner) throw new Error('Could not determine factory owner');

    console.log('Attempting to impersonate factory owner:', owner);
    await network.provider.request({ method: 'hardhat_impersonateAccount', params: [owner] });
    const [funder] = await ethers.getSigners();
    try {
      const bal = await funder.provider.getBalance(owner);
      if (!bal || bal.eq(0)) {
        console.log('Funding impersonated owner with 0.05 ETH from deployer', funder.address);
        const tx = await funder.sendTransaction({ to: owner, value: ethers.parseEther('0.05') });
        await tx.wait();
      }
    } catch (fundErr) { /* ignore */ }

    const imp = await ethers.getSigner(owner);
    const factoryImp = await ethers.getContractAt('ContractFactory', factoryAddr, imp);
    const tx = await factoryImp.setDefaultArbitrationService(arbAddr, 0);
    await tx.wait();
    console.log(`🔧 Set factory default arbitration -> ${arbAddr}`);
    await network.provider.request({ method: 'hardhat_stopImpersonatingAccount', params: [owner] });

    const after = await rent.arbitrationService().catch(() => ethers.ZeroAddress);
    console.log('After factory default arbitration set, template arbitrationService remains:', after);
  } catch (err) {
    console.error('Impersonation/configure failed:', err);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
