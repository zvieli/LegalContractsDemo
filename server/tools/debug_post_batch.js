#!/usr/bin/env node
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const backend = process.env.BACKEND_URL || 'http://localhost:3002';

function now() { return Date.now(); }

async function uploadEvidence(caseId) {
  const evidence = {
    caseId,
    content: 'Debug evidence payload ' + now(),
    uploader: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    timestamp: now()
  };
  const res = await fetch(`${backend}/api/evidence/upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evidence)
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch(e) { return { status: res.status, bodyText: text }; }
}

async function postBatch(caseId, evidenceItems) {
  const payload = { caseId, evidenceItems };
  console.log('Posting batch payload:', JSON.stringify(payload, null, 2));
  const res = await fetch(`${backend}/api/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch(e) { return { status: res.status, bodyText: text }; }
}

async function tailServerErr(n=200) {
  const logPath = path.join(process.cwd(), 'server.err.log');
  if (!fs.existsSync(logPath)) return 'no log file';
  const data = fs.readFileSync(logPath, 'utf8');
  const lines = data.split(/\r?\n/).slice(-n);
  return lines.join('\n');
}

async function main(){
  const caseId = 'debug-case-' + now();
  console.log('Uploading evidence for', caseId);
  const up = await uploadEvidence(caseId);
  console.log('Upload response:', up);
  if (!up || !up.body || !up.body.contentDigest) {
    console.error('Upload did not return contentDigest; aborting. Server logs:\n', await tailServerErr());
    process.exit(2);
  }
  const evidenceItems = [{
    caseId,
    contentDigest: up.body.contentDigest,
    cidHash: up.body.cidHash,
    uploader: up.body.evidence && up.body.evidence.uploader ? up.body.evidence.uploader : '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    timestamp: up.body.evidence && up.body.evidence.timestamp ? up.body.evidence.timestamp : Date.now()
  }];

  console.log('Posting batch...');
  const batchRes = await postBatch(caseId, evidenceItems);
  console.log('Batch response:', batchRes);

  console.log('\n--- tail server.err.log (last 400 lines) ---\n');
  console.log(await tailServerErr(400));
}

main().catch(async (err) => {
  console.error('Debug script error:', err && err.stack ? err.stack : err);
  console.log('\n--- tail server.err.log (last 400 lines) ---\n');
  try { console.log(await tailServerErr(400)); } catch(e){}
  process.exit(3);
});
