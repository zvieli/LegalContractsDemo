import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

const addr = process.argv[2] || '0x98a01f8ff48b849ccaf4d8d987ee200683a1a11e';
const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
const provider = new ethers.JsonRpcProvider(rpc);

const abiPath = path.resolve(process.cwd(), 'front/src/utils/contracts/TemplateRentContractABI.json');
let abiJson;
try {
  abiJson = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
} catch (e) {
  console.error('Could not read ABI at', abiPath, e.message);
  process.exit(1);
}
const abi = abiJson?.default?.abi ?? abiJson?.abi ?? abiJson;

const contract = new ethers.Contract(addr, abi, provider);

async function main() {
  console.log('Inspecting contract', addr, 'on', rpc);
  try {
    const code = await provider.getCode(addr);
    console.log('Contract code present:', code && code !== '0x');
  } catch (e) {
    console.error('getCode failed:', e.message);
  }

  try {
    const [active, cancelRequested, cancelInitiator, cancelEffectiveAt, landlord, tenant] = await Promise.all([
      contract.active().catch(() => null),
      contract.cancelRequested().catch(() => null),
      contract.cancelInitiator().catch(() => null),
      contract.cancelEffectiveAt().catch(() => 0n),
      contract.landlord().catch(() => null),
      contract.tenant().catch(() => null),
    ]);

    console.log('active:', active);
    console.log('cancelRequested:', cancelRequested);
    console.log('cancelInitiator:', cancelInitiator);
    console.log('cancelEffectiveAt (unix):', Number(cancelEffectiveAt || 0n));
    console.log('landlord:', landlord);
    console.log('tenant:', tenant);
  } catch (e) {
    console.error('Read error:', e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
