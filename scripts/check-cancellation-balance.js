import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

async function main() {
  // MODIFY THESE if different
  const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const txHash = process.argv[2] || '0x953637d3f5c0054551da827ddb8cb0ea349c820fefdffbfc3e30599f9d45c4b2';
  const landlord = process.argv[3] || '0xdd2fd4581271e230360230f9337d5c0430bf44c0';
  const tenant = process.argv[4] || '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
  const rentContract = process.argv[5] || '0x63f84713f52422af2f8e18b56703b0f80ccccbce';

  const provider = new ethers.JsonRpcProvider(RPC);

  console.log('RPC:', RPC);
  console.log('txHash:', txHash);
  console.log('landlord:', landlord);
  console.log('tenant:', tenant);
  console.log('rentContract:', rentContract);

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.error('Transaction receipt not found');
    process.exit(1);
  }
  const blockNumber = receipt.blockNumber;
  const blockBefore = blockNumber - 1;
  console.log('blockNumber:', blockNumber);

  // load ABI and create interface
  // __dirname isn't defined in ESM; compute relative path from import.meta.url
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const abiPath = resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
  const raw = JSON.parse(readFileSync(abiPath, 'utf8'));
  const abi = raw.abi || raw;
  const iface = new ethers.Interface(abi);

  // map known event topic -> name to help identify logs
  const eventTopicToName = {};
  for (const frag of iface.fragments) {
    if (frag.type === 'event') {
      try {
        const t = iface.getEventTopic(frag);
        eventTopicToName[t] = frag.name;
      } catch (e) {}
    }
  }

  // Decode and print transaction logs (events) using the ABI iface
  console.log('\n== Transaction logs (decoded) ==');
  function prettyVal(v) {
    try {
      if (typeof v === 'bigint') return ethers.formatEther(v) + ' ETH';
      if (Array.isArray(v)) return v.map(prettyVal);
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return v;
      return String(v);
    } catch (e) {
      return String(v);
    }
  }

  for (const log of receipt.logs) {
    // Try to decode with the rent contract iface first
    try {
      const parsed = iface.parseLog(log);
        console.log(`Event: ${parsed.name}`);
        // Print positional args
        for (let i = 0; i < parsed.args.length; i++) {
          try {
            console.log(`  [${i}]: ${prettyVal(parsed.args[i])}`);
          } catch (e) {}
        }
        // Print named args (if any)
        for (let i = 0; i < parsed.eventFragment.inputs.length; i++) {
          const input = parsed.eventFragment.inputs[i];
          const val = parsed.args[input.name];
          console.log(`  ${input.name} (${input.type}): ${prettyVal(val)}`);
        }
    } catch (e) {
      // Not decoded by this iface; print raw topics/data
      console.log('Unrecognized log at', log.address);
      console.log('  topics:', log.topics);
      console.log('  data  :', log.data);
    }
  }

  // (ABI/interface already loaded above)

  async function callView(fnName, args = [], blockTag) {
    const data = iface.encodeFunctionData(fnName, args);
    const res = await provider.call({ to: rentContract, data }, blockTag);
    try {
      const decoded = iface.decodeFunctionResult(fnName, res);
      // if single return
      if (decoded.length === 1) return decoded[0];
      return decoded;
    } catch (e) {
      // maybe the function doesn't exist or decode failed
      return res;
    }
  }

  function fmt(x) {
    try { return ethers.formatEther(BigInt(x)); } catch (e) { return String(x); }
  }

  const addresses = [landlord.toLowerCase(), tenant.toLowerCase(), rentContract.toLowerCase()];

  console.log('\n== ETH Balances ==');
  for (const a of addresses) {
    const before = await provider.getBalance(a, blockBefore);
    const after = await provider.getBalance(a, blockNumber);
    console.log(`${a}`);
    console.log(`  before (${blockBefore}): ${ethers.formatEther(before)} ETH`);
    console.log(`  after  (${blockNumber}): ${ethers.formatEther(after)} ETH`);
  }

  console.log('\n== Contract state (escrow / withdrawable / partyDeposit) ==');
  const keys = [ 'escrowBalance', 'withdrawable', 'partyDeposit' ];
  for (const k of keys) {
    if (k === 'withdrawable' || k === 'partyDeposit') {
      const beforeL = await callView(k, [landlord], blockBefore);
      const afterL = await callView(k, [landlord], blockNumber);
      const beforeT = await callView(k, [tenant], blockBefore);
      const afterT = await callView(k, [tenant], blockNumber);
      console.log(`\n${k} (landlord)`);
      console.log(`  before: ${fmt(beforeL)}`);
      console.log(`  after : ${fmt(afterL)}`);
      console.log(`${k} (tenant)`);
      console.log(`  before: ${fmt(beforeT)}`);
      console.log(`  after : ${fmt(afterT)}`);
    } else {
      const before = await callView(k, [], blockBefore);
      const after = await callView(k, [], blockNumber);
      console.log(`\n${k}`);
      console.log(`  before: ${fmt(before)}`);
      console.log(`  after : ${fmt(after)}`);
    }
  }

  // Also show cancelRequested and active flags
  console.log('\n== Cancellation / Active flags ==');
  const cancelBefore = await callView('cancelRequested', [], blockBefore);
  const cancelAfter = await callView('cancelRequested', [], blockNumber);
  const activeBefore = await callView('active', [], blockBefore);
  const activeAfter = await callView('active', [], blockNumber);
  console.log(`cancelRequested before: ${String(cancelBefore)}  after: ${String(cancelAfter)}`);
  console.log(`active before: ${String(activeBefore)}  after: ${String(activeAfter)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
