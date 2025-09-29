#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/fetchEvidence.cjs <digest>');
    process.exit(1);
  }

  const digestRaw = String(arg).trim();
  const digest = digestRaw.startsWith('0x') ? digestRaw.toLowerCase() : ('0x' + digestRaw.toLowerCase());

  const port = process.env.EVIDENCE_PORT || process.env.PORT || '5001';
  const base = `http://127.0.0.1:${port}`;

  console.log('Checking evidence endpoint at', base);
  // check /health
  try {
    const res = await fetch(`${base}/health`);
    if (res.ok) {
      const j = await res.json();
      console.log('Server /health:', j);
    } else {
      console.log('/health returned', res.status);
    }
  } catch (e) {
    console.log('Could not contact evidence server at', base, '-', e.message);
  }

  // Look for local index file
  const indexPath = path.join(__dirname, '..', 'evidence_storage', 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.log('No local evidence index found at', indexPath);
    console.log('If the server ran with Helia/IPFS, the evidence may be published to IPFS; check the frontend POST response in the browser network tab.');
    process.exit(0);
  }

  let idxRaw;
  try { idxRaw = fs.readFileSync(indexPath, 'utf8'); } catch (e) { console.error('Failed to read index.json:', e.message); process.exit(1); }
  let idx;
  try { idx = JSON.parse(idxRaw); } catch (e) { console.error('Failed to parse index.json:', e.message); process.exit(1); }

  const entries = Array.isArray(idx.entries) ? idx.entries : (idx.entries ? [idx.entries] : []);
  const match = entries.find(e => (e.digest || '').toLowerCase() === digest.toLowerCase());
  if (!match) {
    console.log('Digest not found in index.json');
    console.log('You can re-run the evidence POST from the frontend and capture the response JSON (it should include cid/uri/digest).');
    process.exit(0);
  }

  console.log('Found entry in index.json:');
  console.log(match);

  // Try to fetch payload based on uri
  const uri = match.uri || match.cid || null;
  if (!uri) {
    console.log('No uri/cid available in index entry');
    process.exit(0);
  }

  if (String(uri).startsWith('file://')) {
    const p = uri.replace('file://', '');
    if (fs.existsSync(p)) {
      const dest = path.join(process.cwd(), `${digest.replace(/^0x/, '')}.bin`);
      fs.copyFileSync(p, dest);
      console.log('Copied local file to', dest);
      process.exit(0);
    } else {
      console.log('Local file referenced by index.json not found:', p);
      process.exit(1);
    }
  }

  if (String(uri).startsWith('ipfs://')) {
    const cid = uri.replace('ipfs://', '').replace(/^\/+/, '');
    // Try local gateway then public gateway
    const candidates = [`http://127.0.0.1:8080/ipfs/${cid}`, `https://ipfs.io/ipfs/${cid}`];
    for (const c of candidates) {
      try {
        console.log('Trying', c);
        const r = await fetch(c);
        if (r.ok) {
          const buf = await r.arrayBuffer();
          const dest = path.join(process.cwd(), `${digest.replace(/^0x/, '')}.bin`);
          fs.writeFileSync(dest, Buffer.from(buf));
          console.log('Saved payload to', dest);
          process.exit(0);
        } else {
          console.log('GET', c, '->', r.status);
        }
      } catch (e) {
        console.log('Error fetching', c, e.message);
      }
    }
    console.log('Could not fetch ipfs content from known gateways. You may need a local IPFS/Helia gateway running or check the evidence server logs.');
    process.exit(1);
  }

  // Otherwise try HTTP(s) GET directly
  try {
    console.log('Trying to GET', uri);
    const r = await fetch(uri);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const dest = path.join(process.cwd(), `${digest.replace(/^0x/, '')}.bin`);
      fs.writeFileSync(dest, Buffer.from(buf));
      console.log('Saved payload to', dest);
      process.exit(0);
    } else {
      console.log('GET', uri, '->', r.status);
      process.exit(1);
    }
  } catch (e) {
    console.log('Failed to GET uri:', e.message);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
