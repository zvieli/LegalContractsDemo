import evidenceBatch from '../modules/evidenceBatch.js';

async function main() {
  const sample = {
    merkleRoot: '0xdead',
    evidenceCount: 1,
    evidenceItems: [],
    timestamp: Date.now(),
    batchId: Date.now(),
    caseId: 'test-case',
    status: 'pending'
  };
  try {
    const res = await evidenceBatch.submitBatch(sample);
    console.log('submitBatch returned:', res);
  } catch (e) {
    console.error('submitBatch threw:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
