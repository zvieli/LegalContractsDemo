import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

async function main() {
  const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const rentContract = process.argv[2] || '0x63f84713f52422af2f8e18b56703b0f80ccccbce';
  const tenant = (process.argv[3] || '0x90f79bf6eb2c4f870365e785982e1f101e93b906').toLowerCase();

  const provider = new ethers.JsonRpcProvider(RPC);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const abiPath = resolve(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
  const raw = JSON.parse(readFileSync(abiPath, 'utf8'));
  const abi = raw.abi || raw;
  const iface = new ethers.Interface(abi);

  console.log('RPC:', RPC);
  console.log('rent contract:', rentContract);
  console.log('tenant:', tenant);

  const latest = await provider.getBlockNumber();
  console.log('latest block:', latest);

  // Fetch logs emitted by the rent contract
  const logs = await provider.getLogs({ address: rentContract, fromBlock: 0, toBlock: latest });
  console.log('total logs from contract:', logs.length);

  const payments = [];
  const parsedEvents = [];

  // Collect and print parsed events (all)
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      parsedEvents.push({ txHash: log.transactionHash, blockNumber: log.blockNumber, name: parsed.name, args: parsed.args });
    } catch (e) {
      // ignore unparsed
    }
  }
  console.log('\nParsed events:');
  for (const ev of parsedEvents) {
    console.log(`${ev.blockNumber} ${ev.txHash} ${ev.name}`);
    // print args
    for (let i = 0; i < ev.args.length; i++) {
      try { console.log(`  [${i}] ${String(ev.args[i])}`); } catch (e) {}
    }
  }

  for (const log of logs) {
    let parsed = null;
    try {
      parsed = iface.parseLog(log);
    } catch (e) {
      // ignore
    }
    if (!parsed) continue;

    const name = parsed.name;
    const txHash = log.transactionHash;
    const blockNumber = log.blockNumber;

    // Collect event types that include amounts
    // Known events we care about: PaymentWithdrawn, PaymentCredited, DepositCredited, CancellationPays, EarlyTerminationFeePaid
    const amountFields = [];
    if (name === 'PaymentWithdrawn') {
      // [who, amount, to?] typical [address, uint256, address?]
      for (const v of parsed.args) if (typeof v === 'bigint') amountFields.push(v);
    } else if (name === 'CancellationPays') {
      // CancellationPays: tenant, landlord, tenantAmount, landlordAmount, fee
      // amounts at positions 2,3,4
      if (parsed.args.length >= 5) {
        amountFields.push(parsed.args[2]);
        amountFields.push(parsed.args[3]);
        amountFields.push(parsed.args[4]);
      }
    } else if (name === 'EarlyTerminationFeePaid') {
      // [from indexed?, amount, to]
      for (const v of parsed.args) if (typeof v === 'bigint') amountFields.push(v);
    } else if (name === 'DepositDebited' || name === 'DebtRecorded' || name === 'DepositCredited' || name === 'PaymentCredited') {
      for (const v of parsed.args) if (typeof v === 'bigint') amountFields.push(v);
    }

    // Format each amount and record
    for (const a of amountFields) {
      const eth = ethers.formatEther(a);
      payments.push({ txHash, blockNumber, event: name, amountEth: eth, raw: a.toString() });
    }
  }

  if (payments.length === 0) {
    console.log('No numeric amounts found in parsed contract events.');
  } else {
    console.log('All parsed numeric amounts in events:');
    for (const p of payments) {
      console.log(`${p.blockNumber} ${p.txHash} ${p.event} ${p.amountEth} ETH`);
    }
  }

  // Also search logs that mention the tenant as indexed topic (topic1..n)
  const tenantTopic = '0x' + tenant.slice(2).padStart(64, '0');
  const logsWithTenant = logs.filter(l => l.topics && l.topics.includes(tenantTopic));
  console.log('\nLogs where tenant is an indexed topic:', logsWithTenant.length);
  for (const l of logsWithTenant) console.log(l.transactionHash, l.topics[0]);

  // Additionally, scan blocks for plain value transfers (EOA -> EOA or contract -> EOA) to the tenant
  console.log('\nScanning blocks for direct ETH transfers to tenant (may take a moment)...');
  const directTxs = [];
  for (let b = 0; b <= latest; b++) {
    const hex = '0x' + b.toString(16);
    // Use RPC directly to fetch block with full tx objects
    const block = await provider.send('eth_getBlockByNumber', [hex, true]);
    if (!block || !block.transactions) continue;
    for (const tx of block.transactions) {
      if (!tx.to) continue;
      if (tx.to.toLowerCase() === tenant && tx.value && BigInt(tx.value) > 0n) {
        directTxs.push({ blockNumber: b, txHash: tx.hash, valueEth: ethers.formatEther(BigInt(tx.value)), from: tx.from });
      }
    }
  }
  if (directTxs.length === 0) {
    console.log('No direct value transfers to tenant found in scanned blocks.');
  } else {
    console.log('Direct ETH transfers to tenant:');
    for (const d of directTxs) console.log(`${d.blockNumber} ${d.txHash} from ${d.from} value ${d.valueEth} ETH`);
  }

}

main().catch(e => { console.error(e); process.exit(1); });
