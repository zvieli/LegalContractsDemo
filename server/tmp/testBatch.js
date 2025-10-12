// ESM test script to POST to /api/batch
const payload = {
  caseId: 'case-debug',
  evidenceItems: [
    {
      caseId: 'case-debug',
      contentDigest: '0x' + '11'.repeat(32),
      cidHash: '0x' + '22'.repeat(32),
      uploader: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      timestamp: Date.now()
    }
  ]
};

async function run() {
  try {
    const res = await fetch('http://localhost:3001/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('STATUS', res.status);
    const txt = await res.text();
    console.log('BODY:', txt);
  } catch (err) {
    console.error('ERROR', err);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
