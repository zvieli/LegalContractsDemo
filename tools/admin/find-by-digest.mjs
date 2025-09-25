#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { keccak256, toUtf8Bytes } from 'ethers';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

async function walk(dir, cb) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) await walk(fp, cb);
    else if (e.isFile()) await cb(fp);
  }
}

async function hashFile(fp) {
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const asIs = keccak256(toUtf8Bytes(raw));
    const trimmed = keccak256(toUtf8Bytes(raw.trim()));
    return { asIs, trimmed };
  } catch (e) {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv[0]) {
    console.error('Usage: node find-by-digest.mjs <0x...digest> [dir1 dir2 ...]');
    process.exit(2);
  }
  const target = argv[0].trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(target)) {
    console.error('Digest must be 0x-prefixed 32-byte hex.');
    process.exit(3);
  }

  const dirs = argv.length > 1 ? argv.slice(1) : ['front', 'tools', 'scripts', 'test', 'contracts', 'front/e2e', 'front/public', '.'];

  const matches = [];
  for (const d of dirs) {
    const abs = path.resolve(process.cwd(), d);
    // skip non-existent
    try {
      const st = await fs.stat(abs);
      if (!st.isDirectory()) continue;
    } catch (e) {
      continue;
    }
    await walk(abs, async (fp) => {
      // skip large binary files
      const ext = path.extname(fp).toLowerCase();
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.wasm') return;
      const h = await hashFile(fp);
      if (!h) return;
      if (h.asIs === target || h.trimmed === target) {
        matches.push({ path: fp, matchedTrimmed: h.trimmed === target, matchedAsIs: h.asIs === target });
      }
    });
  }

  if (matches.length === 0) {
    console.log('No local files matched the digest.');
    process.exit(1);
  }

  console.log('Found matching files:');
  for (const m of matches) console.log(`${m.path}  (matchedAsIs=${m.matchedAsIs} matchedTrimmed=${m.matchedTrimmed})`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(99); });
