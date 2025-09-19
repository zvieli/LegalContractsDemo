#!/usr/bin/env node
/* scanLastTxs.cjs

Scans last N blocks/txs from a JSON-RPC node (default localhost:8545) and
outputs a summary JSON `scan-results.json` in the repo root.

Usage:
  node scripts/scanLastTxs.cjs [rpcUrl] [count]

Example:
  node scripts/scanLastTxs.cjs http://127.0.0.1:8545 500
*/

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const count = parseInt(process.argv[3], 10) || 500;

  console.log(`Connecting to ${rpc} — scanning last ${count} transactions`);
  const provider = new ethers.JsonRpcProvider(rpc);

  // Load ABIs from artifacts folder (simple map by contract name)
  const artifactsDir = path.resolve(__dirname, '..', 'artifacts');

  // Build an ABI decoder map: { addressLower => iface }
  const ifaceByAddr = {};

  function loadIfaces(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const it of items) {
      const p = path.join(dir, it);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        loadIfaces(p);
      } else if (it.endsWith('.json')) {
        try {
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (j && j.abi && j.bytecode !== undefined) {
            const iface = new ethers.Interface(j.abi);
            // heuristics: if contractName found, and networks/address maybe present
            if (j.deployedBytecode && j.deployedBytecode.length > 2) {
              // ignore
            }
            // Save by name as fallback
            ifaceByAddr[PathKey(p)] = iface;
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  }

  function PathKey(filePath) {
    // short key to help identify artifact
    return path.relative(artifactsDir, filePath).replace(/\\/g, '/');
  }

  loadIfaces(artifactsDir);

  const latestBlock = await provider.getBlockNumber();
  const results = {
    rpc,
    scannedAt: new Date().toISOString(),
    latestBlock,
    scannedTxs: [],
    stats: {
      totalChecked: 0,
      failedTxCount: 0,
      contractCalls: 0,
    },
  };

  // Iterate backward collecting tx hashes until we have `count` transactions
  let b = latestBlock;
  while (results.stats.totalChecked < count && b >= 0) {
    const block = await provider.getBlock(b);
    if (!block) break;
    const txHashes = block.transactions || [];
    for (const txHash of txHashes) {
      if (results.stats.totalChecked >= count) break;
      results.stats.totalChecked++;

      try {
        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);
        const failed = receipt && receipt.status === 0;
        if (failed) results.stats.failedTxCount++;

        const decodedLogs = [];
        if (receipt && receipt.logs) {
          for (const log of receipt.logs) {
            // try to decode using any iface we have — naive but helpful
            let decoded = null;
            for (const key of Object.keys(ifaceByAddr)) {
              const iface = ifaceByAddr[key];
              try {
                const d = iface.parseLog({ topics: log.topics, data: log.data });
                decoded = { artifact: key, name: d.name, args: d.args };
                break;
              } catch (e) {
                // not matched
              }
            }
            decodedLogs.push({ address: log.address, topics: log.topics, data: log.data, decoded: decoded ? { artifact: decoded.artifact, name: decoded.name, args: decoded.args } : null });
          }
        }

  const isContractCall = tx && tx.to && tx.to.toLowerCase() !== '0x0000000000000000000000000000000000000000';
        if (isContractCall) results.stats.contractCalls++;

        results.scannedTxs.push({
          hash: txHash,
          blockNumber: receipt ? receipt.blockNumber : block.number,
          from: tx ? tx.from : null,
          to: tx ? tx.to : null,
          value: tx && tx.value ? tx.value.toString() : '0',
          gasUsed: receipt ? receipt.gasUsed.toString() : null,
          status: receipt ? receipt.status : null,
          failed,
          logsCount: receipt ? receipt.logs.length : 0,
          decodedLogs,
        });
      } catch (err) {
        console.error('Error processing tx', txHash, err && err.message ? err.message : err);
      }
    }
    b--;
  }

  const outPath = path.resolve(__dirname, '..', 'scan-results.json');
  // Replacer to serialize BigInt values to strings
  function jsonReplacer(key, value) {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }

  fs.writeFileSync(outPath, JSON.stringify(results, jsonReplacer, 2), 'utf8');
  console.log(`Wrote ${outPath} — scanned ${results.stats.totalChecked} txs, failed ${results.stats.failedTxCount}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
