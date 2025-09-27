#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const artifactsRoot = path.join(repoRoot, 'artifacts', 'contracts');
const destDir = path.join(repoRoot, 'front', 'public', 'utils', 'contracts');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function walkDir(dir, cb) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkDir(p, cb);
    else if (st.isFile() && p.endsWith('.json')) cb(p);
  }
}

ensureDir(destDir);
let count = 0;
walkDir(artifactsRoot, (file) => {
  try {
    const art = readJson(file);
    if (!art || !art.contractName) return;
    const cname = art.contractName;
    const abiOnly = { abi: art.abi };
    const abiFile = path.join(destDir, `${cname}ABI.json`);
    writeJson(abiFile, abiOnly);
    count++;
    const fullFile = path.join(destDir, `${cname}.json`);
    try { writeJson(fullFile, art); } catch (e) {}
    console.log('WROTE', abiFile);
  } catch (e) {
    console.error('SKIP', file, e && e.message ? e.message : e);
  }
});
console.log('Copied', count, 'ABIs to', destDir);
