#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const file = process.argv[2];
const contractAddress = process.argv[3];
if (!file || !contractAddress) {
  console.error('Usage: node scripts/uploadLogs.js <path-to-collect-json> <contractAddress>');
  process.exit(2);
}

(async () => {
  try {
    const raw = fs.readFileSync(path.resolve(file), 'utf8');
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { console.error('Invalid JSON in file:', e.message); process.exit(1); }

    const url = 'http://localhost:3001/api/submit-appeal';
    const body = { contractAddress, userEvidence: obj, encryptToAdmin: false };
    console.log('Posting to', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const txt = await res.text();
    console.log('STATUS', res.status);
    try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); } catch (e) { console.log(txt); }
  } catch (e) {
    console.error('FAILED', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
