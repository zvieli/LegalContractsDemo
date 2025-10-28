#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const cid = process.argv[2];
if (!cid) {
  console.error('Usage: node scripts/getEvidenceByCid.js <cid>');
  process.exit(2);
}

const url = `http://localhost:3001/api/evidence/retrieve/${cid}`;

(async () => {
  try {
    const r = await fetch(url);
    const txt = await r.text();
    const outDir = path.resolve('tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `evidence-${cid}.txt`);
    fs.writeFileSync(outPath, txt, 'utf8');
    console.log('Saved to', outPath);
    console.log(txt);
  } catch (e) {
    console.error('Fetch error:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
