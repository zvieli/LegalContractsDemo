#!/usr/bin/env node
"use strict";
const fs = require('fs');
const path = require('path');
const child = require('child_process');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', 'evidence_storage');
if (!fs.existsSync(STORAGE_DIR)) { console.error('evidence_storage not found'); process.exit(1); }
const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
const report = { total: files.length, good: [], partial: [], none: [], failed: [] };

for (const f of files) {
  const p = path.join(STORAGE_DIR, f);
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const recs = j.recipients || [];
    if (!recs.length) { report.none.push(f); continue; }
    let anyNull = false; let anyCipher = false;
    for (const r of recs) {
      if (!r.encryptedKey) anyNull = true;
      else if (r.encryptedKey && r.encryptedKey.ciphertext) anyCipher = true;
    }
    if (!anyCipher) { report.partial.push(f); continue; }
    // attempt decrypt using admin CLI; rely on admin.key or env
    try {
      const out = child.spawnSync('node', [path.join(__dirname, '..', 'admin', 'decryptEvidence.cjs'), p], { encoding: 'utf8', timeout: 20000 });
      const ok = out.status === 0;
      if (ok) report.good.push({ file: f, stdout: out.stdout.trim().split('\n').slice(-3).join('\n') });
      else report.failed.push({ file: f, stderr: out.stderr.trim().split('\n').slice(-5).join('\n') });
    } catch (e) {
      report.failed.push({ file: f, error: e && e.message ? e.message : String(e) });
    }
  } catch (e) {
    report.failed.push({ file: f, error: e && e.message ? e.message : String(e) });
  }
}

const outPath = path.join(STORAGE_DIR, 'migration_decrypt_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log('Wrote report to', outPath);
console.log('Summary:', 'total=' + report.total, 'good=' + report.good.length, 'partial=' + report.partial.length, 'none=' + report.none.length, 'failed=' + report.failed.length);
