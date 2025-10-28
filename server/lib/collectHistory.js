import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

export async function collectContractHistory(provider, addr, artifactPaths = []) {
  if (!provider) throw new Error('provider required');
  if (!addr) throw new Error('contract address required');

  // Attempt to load ABIs from provided artifactPaths array
  let abiMerged = [];
  for (const base of artifactPaths) {
    try {
      // try common file names under path
      const candidates = [
        path.join(base, 'Rent', 'EnhancedRentContract.sol', 'EnhancedRentContract.json'),
        path.join(base, 'Rent', 'TemplateRentContract.sol', 'TemplateRentContract.json')
      ];
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8');
            const j = JSON.parse(raw);
            if (Array.isArray(j.abi)) abiMerged.push(...j.abi);
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  const iface = abiMerged.length ? new ethers.Interface(abiMerged) : null;

  // determine block window (last 1000 blocks by default)
  let to = 'latest';
  try { to = await provider.getBlockNumber(); } catch (e) { to = 'latest'; }
  let from = typeof to === 'number' ? Math.max(0, to - 1000) : 0;

  let logs = [];
  try {
    logs = await provider.getLogs({ address: addr, fromBlock: Number(from), toBlock: to === 'latest' ? 'latest' : Number(to) });
  } catch (e) {
    // If getLogs fails, return empty array
    return [];
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
        txHash: log.transactionHash,
        date: ts ? new Date(Number(ts) * 1000).toISOString() : null,
        blockNumber: log.blockNumber,
        logIndex: typeof log.logIndex !== 'undefined' ? log.logIndex : log.index,
        raw: log
      });
    } catch (e) {
      // skip
    }
  }

  // sort desc
  entries.sort((a,b) => (b.blockNumber - a.blockNumber) || ((b.logIndex || 0) - (a.logIndex || 0)));
  return entries;
}

export default { collectContractHistory };
