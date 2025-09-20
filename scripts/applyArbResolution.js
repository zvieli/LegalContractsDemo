import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

const addr = process.argv[2];
if (!addr) {
  console.error('Usage: node scripts/applyArbResolution.js <contractAddress>');
  process.exit(1);
}
const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
const provider = new ethers.JsonRpcProvider(rpc);

const rentAbiPath = path.resolve(process.cwd(), 'front/src/utils/contracts/TemplateRentContractABI.json');
const arbAbiPath = path.resolve(process.cwd(), 'front/src/utils/contracts/ArbitrationServiceABI.json');
let rentAbi, arbAbi;
try { rentAbi = JSON.parse(fs.readFileSync(rentAbiPath, 'utf8')).default?.abi ?? JSON.parse(fs.readFileSync(rentAbiPath, 'utf8')).abi ?? JSON.parse(fs.readFileSync(rentAbiPath, 'utf8')); } catch (e) { console.error('Could not read rent ABI', e.message); process.exit(1); }
try { arbAbi = JSON.parse(fs.readFileSync(arbAbiPath, 'utf8')).default?.abi ?? JSON.parse(fs.readFileSync(arbAbiPath, 'utf8')).abi ?? JSON.parse(fs.readFileSync(arbAbiPath, 'utf8')); } catch (e) { console.error('Could not read arbitration ABI', e.message); process.exit(1); }

const rent = new ethers.Contract(addr, rentAbi, provider);

async function main() {
  console.log('Inspecting disputes for', addr);
  const code = await provider.getCode(addr);
  if (!code || code === '0x') {
    console.error('No contract code at target');
    process.exit(1);
  }

  const count = Number(await rent.getDisputesCount().catch(() => 0));
  if (count === 0) {
    console.error('No disputes found to apply');
    process.exit(1);
  }
  const idx = count - 1;
  const d = await rent.getDispute(idx);
  console.log('Dispute raw:', d);
  const initiator = d[0];
  const dtype = Number(d[1]);
  const requested = BigInt(d[2] || 0n);
  const evidence = d[3];
  const resolved = !!d[4];
  const approved = !!d[5];
  const appliedAmount = BigInt(d[6] || 0n);

  console.log({ idx, initiator, dtype, requested: requested.toString(), resolved, approved, appliedAmount: appliedAmount.toString() });

  // read arbitrationService from target
  const svcAddr = await rent.arbitrationService().catch(() => null);
  if (!svcAddr || svcAddr === '0x0000000000000000000000000000000000000000') {
    console.error('No arbitrationService configured on target');
    process.exit(1);
  }
  console.log('ArbitrationService at', svcAddr);

  // use first account exposed by the JSON-RPC provider as signer
  const accounts = await provider.send('eth_accounts', []);
  const signerAddr = accounts && accounts.length > 0 ? accounts[0] : null;
  if (!signerAddr) {
    console.error('No accounts available from provider');
    process.exit(1);
  }

  // Prefer a private key supplied via env var for the signer; otherwise try to parse WALLETS.txt
  let privateKey = process.env.PRIVATE_KEY || null;
  if (!privateKey) {
    try {
      const walletsTxt = fs.readFileSync(path.resolve(process.cwd(), 'WALLETS.txt'), 'utf8');
      // Find the private key for the matching address (case-insensitive)
      const re = new RegExp("Account #[0-9]+: (" + signerAddr.replace(/0x/i, '') + ")", 'i');
      // Fallback: parse any Private Key lines and return the first one for account 0 if direct match fails
      const pkRe = /Private Key: (0x[0-9a-fA-F]+)/g;
      const matches = [...walletsTxt.matchAll(pkRe)];
      if (matches && matches.length > 0) {
        // prefer first private key (account #0)
        privateKey = matches[0][1];
      }
    } catch (e) {
      // ignore
    }
  }

  if (!privateKey) {
    console.error('No private key available (set PRIVATE_KEY env var or include WALLETS.txt in repo)');
    process.exit(1);
  }

  // create a Wallet signer connected to provider
  const signer = new ethers.Wallet(privateKey, provider);
  const ownerAddr = await signer.getAddress();
  console.log('Using signer', ownerAddr);

  const arb = new ethers.Contract(svcAddr, arbAbi, signer);
  try {
    console.log('Calling applyResolutionToTarget on service...');
    const tx = await arb.applyResolutionToTarget(addr, idx, approved, appliedAmount, initiator, { value: 0 });
    console.log('tx sent', tx.hash);
    const receipt = await tx.wait();
    console.log('tx mined', receipt.transactionHash, 'status', receipt.status);
  } catch (e) {
    console.error('applyResolutionToTarget failed:', e?.message || e);
    // Try finalizeTargetCancellation as fallback when approve was intended to finalize cancellation
    if (approved) {
      try {
        console.log('Attempting finalizeTargetCancellation instead (forwarding 0 ETH)');
        const tx2 = await arb.finalizeTargetCancellation(addr, { value: 0 });
        console.log('tx sent', tx2.hash);
        const r2 = await tx2.wait();
        console.log('tx mined', r2.transactionHash, 'status', r2.status);
      } catch (e2) {
        console.error('finalizeTargetCancellation failed:', e2?.message || e2);
      }
    }
  }

  // Re-check active status
  const active = await rent.active().catch(() => null);
  console.log('active after attempt:', active);
}

main().catch(e => { console.error(e); process.exit(1); });
