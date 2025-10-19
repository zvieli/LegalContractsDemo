import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

/**
 * collectContractHistory(provider, contractAddress, abiPaths, fromBlock, toBlock)
 * - provider: ethers Provider instance
 * - contractAddress: address string
 * - abiPaths: array of absolute paths to ABI/JSON artifact files OR single path
 * - fromBlock, toBlock: optional block range to limit logs
 *
 * Returns: Promise<Array< { eventName, args, txHash, blockNumber, blockTimestamp, logIndex, topic0, raw } >>
 */
export async function collectContractHistory(provider, contractAddress, abiPaths, fromBlock = 0, toBlock = 'latest') {
  if (!provider) throw new Error('provider required');
  if (!contractAddress) throw new Error('contractAddress required');

  const addrs = (Array.isArray(abiPaths) ? abiPaths : [abiPaths]).filter(Boolean);
  // Load ABIs and build an Interface capable of decoding logs
  const abi = [];
  for (const p of addrs) {
    try {
      const content = fs.readFileSync(p, 'utf8');
      // Accept either raw ABI array or Hardhat artifact JSON
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        abi.push(...parsed);
      } else if (parsed && parsed.abi) {
        abi.push(...parsed.abi);
      }
    } catch (e) {
      // ignore missing/invalid files
      console.warn('[collectHistory] failed to read ABI at', p, e.message || e);
    }
  }

  const iface = new ethers.Interface(abi);

  // Build filter for logs by address
  const filter = {
    address: contractAddress,
    fromBlock: fromBlock,
    toBlock: toBlock,
  };

  const logs = await provider.getLogs(filter);

  // We'll need block timestamps for each unique block
  const blockMap = new Map();

  const decoded = [];
  for (const log of logs) {
    let decodedEvent = null;
    try {
      decodedEvent = iface.parseLog(log);
    } catch (e) {
      // not an event from this ABI
      decodedEvent = null;
    }

    // Ensure we have block timestamp
    let ts = null;
    if (blockMap.has(log.blockNumber)) ts = blockMap.get(log.blockNumber);
    else {
      try {
        const block = await provider.getBlock(log.blockNumber);
        ts = block ? block.timestamp : null;
        blockMap.set(log.blockNumber, ts);
      } catch (e) {
        ts = null;
      }
    }

    decoded.push({
      eventName: decodedEvent ? decodedEvent.name : null,
      args: decodedEvent ? decodedEvent.args : null,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      blockTimestamp: ts,
      logIndex: log.index || log.logIndex,
      topic0: log.topics && log.topics.length > 0 ? log.topics[0] : null,
      raw: log,
    });
  }

  // sort by blockNumber then logIndex
  decoded.sort((a, b) => (a.blockNumber - b.blockNumber) || ((a.logIndex || 0) - (b.logIndex || 0)));
  return decoded;
}

export default collectContractHistory;
