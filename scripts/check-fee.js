import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

async function main() {
  const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const rentContract = process.argv[2] || '0x63f84713f52422af2f8e18b56703b0f80ccccbce';
  const provider = new ethers.JsonRpcProvider(RPC);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const abiPath = resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
  const raw = JSON.parse(readFileSync(abiPath, 'utf8'));
  const abi = raw.abi || raw;
  const iface = new ethers.Interface(abi);

  const attempts = ['cancellationFeeBps','earlyTerminationFeeBps','feeBps','cancellationFee','cancellationPolicy','noticePeriod','feeRecipient'];

  // Also try public state vars
  const more = ['startDate','durationDays','escrowBalance'];
  for (const name of more) attempts.push(name);

  for (const name of attempts) {
    try {
      const data = iface.encodeFunctionData(name, []);
      const res = await provider.call({ to: rentContract, data });
      const decoded = iface.decodeFunctionResult(name, res);
      console.log(`${name}:`, decoded.length === 1 ? decoded[0].toString() : decoded.map(d=>d.toString()));
    } catch (e) {
      // ignore errors
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
