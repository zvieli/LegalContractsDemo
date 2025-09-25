#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { keccak256, toUtf8Bytes } from 'ethers';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: node tools/admin/check-digest-match.mjs <path-to-ciphertext.json> [expectedDigest]');
    process.exit(2);
  }
  const filePath = path.resolve(process.cwd(), argv[0]);
  const expected = argv[1] || null;
  let s;
  try {
    s = (await fs.readFile(filePath, 'utf8')).trim();
  } catch (e) {
    console.error('Could not read file:', e.message || e);
    process.exit(3);
  }
  const digest = keccak256(toUtf8Bytes(s));
  console.log('Computed digest:', digest);
  if (expected) {
    if (digest.toLowerCase() === expected.toLowerCase()) {
      console.log('OK: matches expected digest');
      process.exit(0);
    } else {
      console.error('MISMATCH: expected', expected, 'but computed', digest);
      process.exit(4);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(99); });
