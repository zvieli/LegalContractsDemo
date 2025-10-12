// ESM-compatible test uploader using global fetch (Node 18+)
import { fileURLToPath } from 'url';

const payload = {
  caseId: 'test-case',
  content: 'test content from ESM uploader',
  uploader: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  timestamp: Date.now()
};

export async function run() {
  try {
    const res = await fetch('http://localhost:3001/api/evidence/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('STATUS', res.status);
    const txt = await res.text();
    try { console.log(JSON.parse(txt)); } catch (e) { console.log(txt); }
  } catch (err) {
    console.error('ERROR', err.message || err);
    process.exitCode = 2;
  }
}

// If invoked directly with node, run immediately
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  // top-level await is allowed in ESM; call and wait
  await run();
}
