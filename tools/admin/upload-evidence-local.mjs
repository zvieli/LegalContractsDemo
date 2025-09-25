#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { keccak256, toUtf8Bytes } from 'ethers';

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(v => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--file' || argv[i] === '-f') && argv[i+1]) file = argv[++i];
    else if (argv[i] === '--outBase' && argv[i+1]) process.env.OUT_BASE = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') { console.log('Usage: upload-evidence-local.mjs --file <path>  OR pipe JSON to stdin'); process.exit(0); }
  }

  let raw;
  if (file) {
    raw = (await fs.readFile(path.resolve(process.cwd(), file), 'utf8')).trim();
  } else {
    raw = (await readStdin()).trim();
  }

  if (!raw) { console.error('No input ciphertext found (file or stdin).'); process.exit(2); }

  // If raw looks like JSON, parse and reserialize canonically so the digest
  // and on-disk bytes are stable and deterministic.
  let canonical = raw;
  try {
    const parsed = JSON.parse(raw);
    canonical = stableStringify(parsed);
  } catch (_) {
    // not JSON - keep raw as-is
    canonical = raw;
  }

  // compute digest over exact UTF-8 bytes of the canonical serialization
  const digest = keccak256(toUtf8Bytes(canonical));
  const digestNo0x = digest.replace(/^0x/, '');

  // default destination: front/e2e/static/<digest>.json (used by local Playwright static server)
  const base = process.env.OUT_BASE || path.join('front', 'e2e', 'static');
  const destDir = path.resolve(process.cwd(), base);
  await fs.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, `${digestNo0x}.json`);

  // Write the canonical bytes to disk to ensure digest/file match.
  await fs.writeFile(destPath, canonical, 'utf8');

  console.log('Wrote ciphertext to:', destPath);
  // Suggest URL for Playwright static server (port 5174) or front dev (5173)
  console.log('\nSuggested fetch URLs (pick according to your dev server):');
  console.log(`  http://localhost:5174/${digestNo0x}.json   # front/e2e static server`);
  console.log(`  http://localhost:5173/utils/evidence/${digestNo0x}.json   # adjust if you host under front/public`);
  console.log('\nComputed digest:', digest);
}

main().catch(e => { console.error('Fatal:', e); process.exit(99); });
