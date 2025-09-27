#!/usr/bin/env node
/* Reproduce a reportDispute call from a node-side Wallet to compare behavior
   Usage: node scripts/debug-report-dispute.js <contractAddress> <disputeType> <amountWei> <digestHex> [--rpc http://127.0.0.1:8545] [--pk 0x...]
*/
import process from 'process';
import path from 'path';
import fs from 'fs/promises';
import { JsonRpcProvider, Wallet, Contract, ethers } from 'ethers';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node debug-report-dispute.js <contractAddress> <disputeType> <amountWei> <digestHex> [--rpc url] [--pk pk]');
    process.exit(2);
  }
  let [contractAddress, disputeType, amountWei, digestHex] = args;
  const rpcIdx = args.indexOf('--rpc');
  const pkIdx = args.indexOf('--pk');
  const rpc = rpcIdx >= 0 ? args[rpcIdx+1] : process.env.PLAYWRIGHT_RPC_URL || 'http://127.0.0.1:8545';
  const pk = pkIdx >= 0 ? args[pkIdx+1] : process.env.TEST_PK || null;
  if (!pk) {
    console.error('Provide --pk private key or set TEST_PK env var');
    process.exit(3);
  }
  const root = process.cwd();
  const abiPath = path.join(root, 'front', 'public', 'utils', 'contracts', 'TemplateRentContract.json');
  let abiJson = null;
  try { abiJson = JSON.parse(await fs.readFile(abiPath, 'utf8')); } catch (e) { console.error('Failed to read ABI at', abiPath, e); process.exit(4); }
  const provider = new JsonRpcProvider(rpc);
  const w = new Wallet(pk, provider);
  console.log('Using wallet', await w.getAddress(), 'rpc', rpc, 'target', contractAddress);
  const contract = new Contract(contractAddress, abiJson.abi || abiJson, w);
  try {
    const code = await provider.getCode(contractAddress);
    console.log('Contract code size', code ? code.length : 0);
  } catch (e) { console.warn('Could not fetch code', e); }
  try {
    console.log('Calling reportDispute via node wallet...');
    const tx = await contract.reportDispute(Number(disputeType), BigInt(amountWei), String(digestHex));
    console.log('Sent tx hash', tx.hash);
    const r = await tx.wait();
    console.log('Receipt ok. events:', r.events ? r.events.map(e=>e.event) : r.logs.length);
  } catch (e) {
    console.error('Node-side reportDispute failed:', e);
    try { console.error('Error data', e?.data || e?.error || e?.reason || e?.message); } catch(_){}
    process.exit(5);
  }
}

main().catch(e=>{ console.error(e); process.exit(6); });
