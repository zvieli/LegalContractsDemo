#!/usr/bin/env node
// Anchor evidence CID on local Hardhat chain by calling submitEvidenceWithSignature
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

function canonicalize(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(e => canonicalize(e)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const parts = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

async function main() {
  const cid = process.argv[2];
  if (!cid) {
    console.error('Usage: node scripts/anchorEvidence.js <cid>');
    process.exit(1);
  }
  const cidRaw = String(cid).replace(/^helia:\/\//i, '');
  const inPath = path.join('tmp', `evidence-${cidRaw}.json`);
  if (!fs.existsSync(inPath)) {
    console.error('Evidence file not found:', inPath);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const payload = (data && data.plaintext && data.plaintext.payload) ? data.plaintext.payload : null;
  if (!payload) {
    console.error('No plaintext.payload found in evidence file');
    process.exit(1);
  }

  // compute canonical content digest
  const canon = canonicalize(payload);
  const contentDigest = ethers.keccak256(ethers.toUtf8Bytes(canon));
  console.log('contentDigest:', contentDigest);

  // prepare EIP-712
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
  const network = await provider.getNetwork();
  console.log('Network chainId:', network.chainId);

  // Use plaintiff's private key from WALLETS.txt (account18) for signer
  // For local dev this file exists; fallback to env PRIVATE_KEY
  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    try {
      const w = fs.readFileSync('WALLETS.txt','utf8');
      const m = w.match(/Account18[\s\S]*?Private Key:\s*(0x[0-9a-fA-F]+)/);
      if (m) privateKey = m[1];
    } catch (e) { void e; }
  }
  if (!privateKey) {
    console.error('No PRIVATE_KEY found in env or WALLETS.txt (Account18). Set PRIVATE_KEY env or update script.');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const uploader = await wallet.getAddress();
  console.log('Using uploader address:', uploader);

  const domain = {
    name: 'TemplateRentContract',
    version: '1',
    chainId: network.chainId,
    verifyingContract: payload.contractAddress
  };
  const types = {
    Evidence: [
      { name: 'caseId', type: 'uint256' },
      { name: 'contentDigest', type: 'bytes32' },
      { name: 'recipientsHash', type: 'bytes32' },
      { name: 'uploader', type: 'address' },
      { name: 'cid', type: 'string' }
    ]
  };
  const caseId = 0; // default when unknown
  const recipientsHash = ethers.ZeroHash;
  const message = {
    caseId: caseId,
    contentDigest: contentDigest,
    recipientsHash: recipientsHash,
    uploader: uploader,
    cid: cidRaw
  };

  // sign typed data
  const signature = await wallet.signTypedData(domain, types, message);
  console.log('signature:', signature);

  // load ABI
  const abiPath = 'server/config/contracts/TemplateRentContract.json';
  const abiJson = JSON.parse(fs.readFileSync(abiPath,'utf8'));
  const abi = abiJson.abi;
  const contract = new ethers.Contract(payload.contractAddress, abi, wallet);

  if (typeof contract.submitEvidenceWithSignature !== 'function') {
    console.error('Contract does not expose submitEvidenceWithSignature; aborting');
    process.exit(1);
  }

  console.log('Submitting on-chain evidence...');
  const tx = await contract.submitEvidenceWithSignature(caseId, cidRaw, contentDigest, recipientsHash, signature);
  console.log('tx.hash', tx.hash);
  const receipt = await tx.wait();
  console.log('tx mined in block', receipt.blockNumber);
  const outPath = path.join('tmp', `anchor-${cidRaw}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ txHash: tx.hash, blockNumber: receipt.blockNumber, receipt }, null, 2));
  console.log('Wrote anchor info to', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
