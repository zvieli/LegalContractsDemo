import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

/**
 * collectContractHistory(provider, contractAddress, abiPaths = [], fromBlock=0, toBlock='latest')
 * - provider: ethers Provider instance
 * - contractAddress: address string
 * - abiPaths: array of artifact paths or directories to search for ABIs
 * - fromBlock, toBlock: optional block range
 *
 * Returns: Promise<Array< { eventName, args, txHash, blockNumber, blockTimestamp, logIndex, topic0, raw } >>
 */
export async function collectContractHistory(provider, contractAddress, abiPaths = [], fromBlock = null, toBlock = 'latest') {
  if (!provider) throw new Error('provider required');
  if (!contractAddress) throw new Error('contractAddress required');

  const paths = Array.isArray(abiPaths) ? abiPaths : (abiPaths ? [abiPaths] : []);
  const abi = [];

  for (const p of paths) {
    try {
      const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const files = fs.readdirSync(abs);
        for (const f of files) {
          if (!f.toLowerCase().endsWith('.json')) continue;
          try {
            const content = fs.readFileSync(path.join(abs, f), 'utf8');
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) abi.push(...parsed);
            else if (parsed && parsed.abi) abi.push(...parsed.abi);
            else if (parsed && parsed.contracts) {
              for (const k of Object.keys(parsed.contracts)) {
                const c = parsed.contracts[k];
                if (c && c.abi) abi.push(...c.abi);
              }
            }
          } catch (e) {
            // ignore per-file parse errors
          }
        }
      } else if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        try {
          const content = fs.readFileSync(abs, 'utf8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) abi.push(...parsed);
          else if (parsed && parsed.abi) abi.push(...parsed.abi);
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // continue
    }
  }

  const iface = abi.length ? new ethers.Interface(abi) : null;

  // Normalize blocks: resolve 'latest' to a number and ensure numeric ranges
  let from = (typeof fromBlock !== 'undefined' && fromBlock !== null) ? Number(fromBlock) : null;
  // If caller didn't provide fromBlock, default to a recent window to avoid huge eth_getLogs queries
  const DEFAULT_WINDOW = 1000;
  let to;
  if (toBlock === 'latest' || toBlock === 'pending' || toBlock == null) {
    try {
      to = await provider.getBlockNumber();
    } catch (e) {
      // if provider.getBlockNumber fails, fallback to from as to
      to = from;
    }
  } else {
    to = Number(toBlock);
    if (Number.isNaN(to)) to = from;
  }

  if (from === null) {
    // Try to read a fromBlock from deployment-summary.json to narrow queries
    try {
      const dsPath = path.join(process.cwd(), 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
      if (fs.existsSync(dsPath)) {
        try {
          const ds = JSON.parse(fs.readFileSync(dsPath, 'utf8'));
          if (ds && typeof ds.fromBlock !== 'undefined' && ds.fromBlock !== null) {
            const candidate = Number(ds.fromBlock);
            if (!Number.isNaN(candidate)) {
              from = candidate;
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    } catch (e) {
      // ignore
    }

    // If still null, set from to a recent window start
    if (from === null) {
      from = Math.max(0, (typeof to === 'number' ? to : 0) - DEFAULT_WINDOW + 1);
    }
  }

  // Safety: avoid sweeping huge ranges (which often trigger upstream providers like Alchemy when
  // Hardhat is run with a mainnet fork). If the requested range is enormous, limit to a recent
  // tail window unless the env var FORCE_FULL_LOGS=true is set.
  const MAX_SAFE_RANGE = 5000; // blocks
  try {
    const numericFrom = Number(from);
    const numericTo = Number(to);
    if (!Number.isNaN(numericFrom) && !Number.isNaN(numericTo)) {
      const range = Math.abs(numericTo - numericFrom);
      if (range > MAX_SAFE_RANGE && process.env.FORCE_FULL_LOGS !== 'true') {
        const newFrom = Math.max(0, numericTo - DEFAULT_WINDOW + 1);
        console.warn(`[collectContractHistory] requested block range ${numericFrom}-${numericTo} is > ${MAX_SAFE_RANGE} blocks; limiting to recent window ${newFrom}-${numericTo}. Set FORCE_FULL_LOGS=true to override.`);
        from = newFrom;
      }
    }
  } catch (e) {
    // ignore, continue with computed from/to
  }

  const filterBase = { address: contractAddress };

  // Prefer local RPC for logs/blocks to avoid hitting Alchemy when using a forked node on disk.
  // We'll create a dedicated local provider for getLogs/getBlock calls. Do not pre-ping it
  // (to avoid false negatives); instead attempt local calls and fall back to the supplied
  // provider on a per-call basis.
  const LOCAL_RPC = process.env.LOCAL_RPC || 'http://127.0.0.1:8545';
  const localProvider = new ethers.JsonRpcProvider(LOCAL_RPC);
  console.log(`[collectContractHistory] using LOCAL RPC for logs/blocks only: ${LOCAL_RPC} (no upstream fallback)`);

  // Try single getLogs first; if it fails (e.g., Alchemy HTTP 400 on large ranges), fall back to chunked retrieval
  let logs = [];
  try {
    try {
      // LOCAL ONLY: try local provider for all logs
      logs = await localProvider.getLogs({ ...filterBase, fromBlock: from, toBlock: to });
    } catch (localErr) {
      console.warn(`[collectContractHistory] local getLogs failed on ${LOCAL_RPC}; not falling back to upstream to avoid Alchemy calls:`, localErr && localErr.message);
      // Return empty logs rather than contacting upstream provider
      logs = [];
    }
  } catch (err) {
    console.warn('[collectContractHistory] provider.getLogs single call failed, falling back to chunked fetch:', err && (err.message || err));
    // Chunked fetch - progressively attempt ranges to avoid upstream rejections
    const CHUNK_SIZE = 5000; // blocks per chunk; conservative default
      try {
      let cursor = from;
      while (cursor <= to) {
        const chunkEnd = Math.min(cursor + CHUNK_SIZE - 1, to);
          try {
          // LOCAL ONLY: try local provider for this chunk
          let chunkLogs = [];
          try {
            chunkLogs = await localProvider.getLogs({ ...filterBase, fromBlock: cursor, toBlock: chunkEnd });
          } catch (lpErr) {
            console.warn(`[collectContractHistory] local chunk getLogs failed on ${LOCAL_RPC} for ${cursor}-${chunkEnd}; skipping chunk to avoid upstream calls:`, lpErr && lpErr.message);
            chunkLogs = [];
          }
          if (Array.isArray(chunkLogs) && chunkLogs.length) logs.push(...chunkLogs);
          } catch (chunkErr) {
          // If a chunk fails, try to reduce chunk size and retry that window with local-only provider
          console.warn(`[collectContractHistory] chunk getLogs failed for ${cursor}-${chunkEnd}; last tried endpoint: ${LOCAL_RPC}:`, chunkErr && chunkErr.message);
          // reduce window and retry per-block if necessary
          let smallStart = cursor;
          const SMALL_CHUNK = 200; // try smaller windows
          while (smallStart <= chunkEnd) {
            const smallEnd = Math.min(smallStart + SMALL_CHUNK - 1, chunkEnd);
            try {
              // LOCAL ONLY: try local provider for small window
              try {
                const smallLogs = await localProvider.getLogs({ ...filterBase, fromBlock: smallStart, toBlock: smallEnd });
                if (Array.isArray(smallLogs) && smallLogs.length) logs.push(...smallLogs);
              } catch (sLocalErr) {
                console.warn(`[collectContractHistory] local small window failed on ${LOCAL_RPC} ${smallStart}-${smallEnd}; skipping:`, sLocalErr && sLocalErr.message);
              }
            } catch (smallErr) {
              // give up on this tiny window after failure and continue
              console.warn(`[collectContractHistory] small window failed ${smallStart}-${smallEnd}:`, smallErr && smallErr.message);
            }
            smallStart = smallEnd + 1;
          }
        }
        cursor = chunkEnd + 1;
      }
    } catch (finalErr) {
      // If everything fails, rethrow original error for caller to decide; but include collected logs so far
      console.warn('[collectContractHistory] chunked retrieval also failed:', finalErr && finalErr.message);
      if (logs.length === 0) throw err;
    }
  }

  const blockMap = new Map();
  const decoded = [];

  for (const log of logs) {
    let parsed = null;
    if (iface) {
      try {
        parsed = iface.parseLog(log);
      } catch (e) {
        parsed = null;
      }
    }

    let ts = null;
    if (blockMap.has(log.blockNumber)) ts = blockMap.get(log.blockNumber);
    else {
      // Try local provider first, then upstream provider if local fails
      try {
        const block = await localProvider.getBlock(log.blockNumber);
        ts = block ? block.timestamp : null;
        blockMap.set(log.blockNumber, ts);
        console.log(`[collectContractHistory] getBlock(${log.blockNumber}) succeeded via LOCAL RPC ${LOCAL_RPC}`);
      } catch (localBlockErr) {
        console.warn(`[collectContractHistory] local getBlock failed on ${LOCAL_RPC} for block ${log.blockNumber}:`, localBlockErr && localBlockErr.message);
        try {
          const upstreamUrl = (provider && provider.connection && provider.connection.url) ? provider.connection.url : 'upstream-provider';
          const block = await provider.getBlock(log.blockNumber);
          ts = block ? block.timestamp : null;
          blockMap.set(log.blockNumber, ts);
          console.log(`[collectContractHistory] getBlock(${log.blockNumber}) succeeded via upstream provider ${upstreamUrl}`);
        } catch (upErr) {
          console.warn(`[collectContractHistory] upstream getBlock also failed for block ${log.blockNumber}:`, upErr && upErr.message);
          ts = null;
        }
      }
    }

    decoded.push({
      eventName: parsed ? parsed.name : null,
      args: parsed ? parsed.args : null,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      blockTimestamp: ts,
      logIndex: typeof log.logIndex !== 'undefined' ? log.logIndex : log.index,
      topic0: Array.isArray(log.topics) && log.topics.length ? log.topics[0] : null,
      raw: log,
    });
  }

  decoded.sort((a, b) => (a.blockNumber - b.blockNumber) || ((a.logIndex || 0) - (b.logIndex || 0)));
  return decoded;
}

export default collectContractHistory;
