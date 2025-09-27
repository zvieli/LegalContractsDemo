#!/usr/bin/env node
/* Reproduce NDATemplate.reportBreach call from a node-side Wallet
   Usage: node scripts/debug-report-nda.js <contractAddress> <offender> <requestedWei> <evidenceHex> [--rpc http://127.0.0.1:8545] [--pk 0x...]
*/
import process from 'process';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

async function main(){
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node debug-report-nda.js <contractAddress> <offender> <requestedWei> <evidenceHex> [--rpc url] [--pk pk]');
    process.exit(2);
  }
  let [contractAddress, offender, requestedWei, evidenceHex] = args;
  const rpcIdx = args.indexOf('--rpc');
  const pkIdx = args.indexOf('--pk');
  const rpc = rpcIdx >= 0 ? args[rpcIdx+1] : process.env.PLAYWRIGHT_RPC_URL || 'http://127.0.0.1:8545';
  const pk = pkIdx >= 0 ? args[pkIdx+1] : process.env.TEST_PK || null;
  if (!pk) {
    console.error('Provide --pk private key or set TEST_PK env var');
    process.exit(3);
  }

  const provider = new JsonRpcProvider(rpc);
  const w = new Wallet(pk, provider);
  console.log('Using wallet', await w.getAddress(), 'rpc', rpc, 'target', contractAddress);

  const abi = [
    'function reportBreach(address _offender, uint256 _requested, bytes32 _evidence) payable',
  ];
  const contract = new Contract(contractAddress, abi, w);
  try {
    const code = await provider.getCode(contractAddress);
    console.log('Contract code length', code ? code.length : 0);
  } catch (e) { console.warn('Could not fetch code', e); }

  try {
    console.log('Sending reportBreach...');
    const tx = await contract.reportBreach(offender, BigInt(requestedWei), evidenceHex, { value: BigInt(requestedWei) });
    console.log('Sent tx hash', tx.hash);
    const rc = await tx.wait();
    console.log('Receipt succeeded, events:', rc.events ? rc.events.map(e=>e.event) : rc.logs.length);
  } catch (e) {
    console.error('Node-side reportBreach failed:', e);
    // Try to extract revert data
    try { console.error('Error details:', e?.reason || e?.message || e); } catch(_){}
    process.exit(4);
  }
}

main().catch(e=>{ console.error(e); process.exit(5); });
