#!/usr/bin/env node
// Simple helper to run ContractService.collectTransactionHistory from Node
// Usage: node tools/collectHistory.js <contractAddress> [fromBlock] [toBlock]
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
// We'll implement a local version of collectTransactionHistory here to avoid
// importing frontend-only modules. It will:
//  - load ABIs from artifacts for EnhancedRentContract and TemplateRentContract
//  - merge ABIs, create ethers.Interface
//  - query provider.getLogs for the address and decode logs

async function main() {
  const argv = process.argv.slice(2);
  if (!argv[0]) {
    console.error('Usage: node tools/collectHistory.js <contractAddress> [fromBlock] [toBlock]');
    process.exit(2);
  }
  const addr = argv[0];
  const fromBlock = argv[1] ? Number(argv[1]) : null;
  const toBlock = argv[2] ? argv[2] : 'latest';

  const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
  console.log('[collectHistory] using RPC:', rpc);
  const provider = new ethers.JsonRpcProvider(rpc);

  // Load ABIs from artifacts
  const abiFiles = [
    path.join(process.cwd(), 'artifacts', 'contracts', 'Rent', 'EnhancedRentContract.sol', 'EnhancedRentContract.json'),
    path.join(process.cwd(), 'artifacts', 'contracts', 'Rent', 'TemplateRentContract.sol', 'TemplateRentContract.json')
  ];
  let abiMerged = [];
  for (const p of abiFiles) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const j = JSON.parse(raw);
      if (Array.isArray(j.abi)) abiMerged.push(...j.abi);
    } catch (e) {
      // ignore missing
    }
  }

  const iface = abiMerged.length ? new ethers.Interface(abiMerged) : null;

  // determine block window
  let to = toBlock;
  try { if (to === 'latest') to = await provider.getBlockNumber(); } catch (_){ to = 'latest'; }
  let from = fromBlock;
  if (from === null || typeof from === 'undefined') {
    try {
      const cur = typeof to === 'number' ? to : await provider.getBlockNumber();
      from = Math.max(0, cur - 1000);
    } catch (_){ from = 0; }
  }

  console.log(`[collectHistory] querying logs for ${addr} from ${from} to ${to}`);
  let logs = [];
  try {
    logs = await provider.getLogs({ address: addr, fromBlock: Number(from), toBlock: to === 'latest' ? 'latest' : Number(to) });
  } catch (e) {
    console.error('[collectHistory] getLogs failed:', e && e.message ? e.message : e);
    process.exit(1);
  }

  const blockCache = new Map();
  const entries = [];
  for (const log of logs) {
    try {
      let parsed = null;
      if (iface) {
        try { parsed = iface.parseLog(log); } catch (_){ parsed = null; }
      }
      let ts = null;
      try {
        if (blockCache.has(log.blockNumber)) ts = blockCache.get(log.blockNumber);
        else {
          const block = await provider.getBlock(log.blockNumber);
          ts = block ? block.timestamp : null;
          blockCache.set(log.blockNumber, ts);
        }
      } catch (_){ ts = null; }

      const evName = parsed ? parsed.name : null;
      const args = parsed ? parsed.args : null;
      let amount = null;
      if (args) amount = args.amount || args.value || null;
      const amountEth = amount ? ethers.formatEther(BigInt(amount.toString())) : null;

      entries.push({
        eventName: evName,
        args: args ? Object.fromEntries(Object.keys(args).filter(k => isNaN(Number(k))).map(k => [k, String(args[k])])) : null,
        amount: amountEth || '0',
        hash: log.transactionHash,
        date: ts ? new Date(Number(ts) * 1000).toLocaleString() : null,
        blockNumber: log.blockNumber,
        logIndex: typeof log.logIndex !== 'undefined' ? log.logIndex : log.index,
        raw: log
      });
    } catch (e) {
      console.warn('[collectHistory] decode failed for log', e && e.message ? e.message : e);
    }
  }

  // sort desc
  entries.sort((a,b) => (b.blockNumber - a.blockNumber) || ((b.logIndex || 0) - (a.logIndex || 0)));

  const outDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const safeAddr = addr.replace(/[:]/g, '_');
  const outPath = path.join(outDir, `collect-${safeAddr}.json`);
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), 'utf8');
  console.log('[collectHistory] saved', outPath);
  console.log(JSON.stringify({ count: entries.length, path: outPath }, null, 2));
}

main();
