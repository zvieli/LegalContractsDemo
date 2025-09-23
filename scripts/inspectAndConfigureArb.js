import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  // Allow passing the target address via env var TARGET for compatibility with `npx hardhat run`.
  const target = process.env.TARGET || args[0];
  if (!target) {
    console.error('Usage: TARGET=<address> npx hardhat run scripts/inspectAndConfigureArb.js --network localhost');
    console.error('Or: node scripts/inspectAndConfigureArb.js <contractAddress> [--configure]');
    process.exit(2);
  }
  const shouldConfigure = args.includes('--configure') || process.env.CONFIGURE_ARBITRATION === 'true';

  console.log('Inspecting target:', target);
  const signer = (await ethers.getSigners())[0];
  const Template = await ethers.getContractAt('TemplateRentContract', target, signer);

  const info = {};
  info.arbitrationService = await Template.arbitrationService().catch(() => null);
  info.cancelRequested = await Template.cancelRequested().catch(() => null);
  info.cancelInitiator = await Template.cancelInitiator().catch(() => null);
  info.earlyTerminationFeeBps = (await Template.earlyTerminationFeeBps().catch(() => 0)).toString();
  try { info.requiredDeposit = (await Template.requiredDeposit()).toString(); } catch (_) { info.requiredDeposit = null; }
  try { info.depositBalance = (await Template.depositBalance()).toString(); } catch (_) { info.depositBalance = null; }

  console.log('On-chain state:', info);

  // If requested, configure arbitrationService using local ContractFactory.json
  if (shouldConfigure) {
  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const frontendContractsDir = getFrontendContractsDir();
    const factoryFile = path.join(frontendContractsDir, 'ContractFactory.json');
    if (!fs.existsSync(factoryFile)) {
      console.error('ContractFactory.json not found in frontend utils - cannot discover ArbitrationService address to configure');
      process.exit(3);
    }
    const parsed = JSON.parse(fs.readFileSync(factoryFile, 'utf8') || '{}');
    const arb = parsed?.contracts?.ArbitrationService || null;
    if (!arb) {
      console.error('No ArbitrationService address in ContractFactory.json');
      process.exit(4);
    }
    console.log('Configuring factory default arbitration to:', arb);
    // Attempt to set factory-level default arbitration so new contracts pick it up
    try {
      const frontendContractsDir = path.join(__dirname, '../front/src/utils/contracts');
      const factoryFile = path.join(frontendContractsDir, 'ContractFactory.json');
      if (!fs.existsSync(factoryFile)) {
        console.error('ContractFactory.json not found in frontend utils - cannot discover factory address to configure');
        process.exit(3);
      }
      const parsedFactory = JSON.parse(fs.readFileSync(factoryFile, 'utf8') || '{}');
      const factoryAddr = parsedFactory?.contracts?.ContractFactory || null;
      if (!factoryAddr) {
        console.error('No ContractFactory address in ContractFactory.json');
        process.exit(4);
      }
      const factoryInstance = await ethers.getContractAt('ContractFactory', factoryAddr, signer);
      const tx = await factoryInstance.setDefaultArbitrationService(arb, 0);
      await tx.wait();
      console.log('Configured factory default arbitration successfully.');
    } catch (err) {
      console.error('Failed to set factory default arbitration (direct call):', err.message || err);
      // Fallback: try impersonating factory owner on local network
      try {
        const localNames = ['localhost', 'hardhat'];
        if (!localNames.includes(network.name) && Number(process.env.CHAIN_ID) !== 31337) {
          throw new Error('Cannot impersonate on non-local network');
        }
        const frontendContractsDir = path.join(__dirname, '../front/src/utils/contracts');
        const factoryFile = path.join(frontendContractsDir, 'ContractFactory.json');
        const parsedFactory = JSON.parse(fs.readFileSync(factoryFile, 'utf8') || '{}');
        const factoryAddr = parsedFactory?.contracts?.ContractFactory || null;
        if (!factoryAddr) throw new Error('Cannot find factory address for impersonation');
        const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        // Determine owner by reading factory.owner()
        const factoryRead = await ethers.getContractAt('ContractFactory', factoryAddr, signer);
        const owner = await factoryRead.owner().catch(() => null);
        if (!owner) throw new Error('Could not determine factory owner');
        console.log('Attempting to impersonate factory owner:', owner);
        await provider.send('hardhat_impersonateAccount', [owner]);
        const impSigner = await ethers.getSigner(owner);
        const factoryImp = await ethers.getContractAt('ContractFactory', factoryAddr, impSigner);
        const tx2 = await factoryImp.setDefaultArbitrationService(arb, 0);
        await tx2.wait();
        console.log('Configured factory default arbitration via impersonation successfully.');
        await provider.send('hardhat_stopImpersonatingAccount', [owner]);
      } catch (impErr) {
        console.error('Impersonation fallback failed:', impErr.message || impErr);
        process.exit(5);
      }
    }
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
