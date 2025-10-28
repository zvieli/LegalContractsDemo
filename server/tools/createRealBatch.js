import evidenceBatch from '../modules/evidenceBatch.js';
import { ethers } from 'ethers';

async function main() {
  const caseId = `smoke-real-${Date.now()}`;
  const now = Date.now();
  const content = `smoke-content-${now}`;
  const contentDigest = ethers.keccak256(ethers.toUtf8Bytes(content));
  const cidHash = ethers.keccak256(ethers.toUtf8Bytes(`cid-${now}`));
  const evidenceItems = [
    {
      caseId: String(now),
      contentDigest,
      cidHash,
      uploader: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      timestamp: String(now)
    }
  ];

  console.log('Creating real batch for', caseId);
  try {
    const result = await evidenceBatch.createBatch(caseId, evidenceItems);
    console.log('createBatch result:', result);
  } catch (e) {
    console.error('createBatch failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
