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
  console.log('Inspecting disputes for', addr, 'on', rpc);
  try {
    const code = await provider.getCode(addr);
    console.log('Contract code present:', code && code !== '0x');
  } catch (e) {
    console.error('getCode failed:', e.message);
  }

  try {
    const count = Number(await contract.getDisputesCount().catch(() => 0));
    console.log('getDisputesCount:', count);
    if (count > 0) {
      const idx = count - 1;
      console.log('Reading dispute at index', idx);
      const d = await contract.getDispute(idx).catch((e) => { console.error('getDispute failed:', e?.message||e); return null; });
      console.log('raw dispute:', d);
      try {
        // Attempt friendly decoding if it's an array-like
        if (d) {
          // Print field indexes and values
          for (let i = 0; i < d.length; i++) {
            console.log(`  [${i}] =>`, d[i]);
          }
        }
      } catch (_) {}
    }
  } catch (e) {
    console.error('Read error:', e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
