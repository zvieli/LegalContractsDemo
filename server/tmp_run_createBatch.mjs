import evidenceBatch from './modules/evidenceBatch.js';

async function run() {
  const caseId = 'case-debug-1234';
  const evidenceItems = [
    {
      caseId,
      contentDigest: '0x' + '11'.repeat(32),
      cidHash: '0x' + '22'.repeat(32),
      uploader: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      timestamp: Date.now()
    }
  ];
  try {
    const res = await evidenceBatch.createBatch(caseId, evidenceItems);
    console.log('createBatch result:', res);
  } catch (e) {
    console.error('createBatch threw:', e && e.stack ? e.stack : e);
  }
}

run();
