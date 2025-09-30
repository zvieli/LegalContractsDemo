// Simple ESM CLI to decrypt an evidence file produced by the evidence endpoint.
// Usage: node tools/admin/decrypt-cli.js --file <cipherfile> --out-file <outpath>

import fs from 'fs';
import path from 'path';
import fsPromises from 'fs/promises';
import { decryptEvidencePayload } from './decryptHelper.js';
import { fetchFromVault as vaultFetch } from './vaultClient.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && i + 1 < argv.length) { out.file = argv[++i]; continue; }
    if ((a === '--out-file' || a === '-o') && i + 1 < argv.length) { out.outFile = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function usage() {
  console.error('Usage: node tools/admin/decrypt-cli.js --file <cipherFile> --out-file <outpath>');
  console.error('  ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY_FILE may be used to provide the admin private key.');
  console.error('  Alternatively set VAULT_ADDR/VAULT_TOKEN/VAULT_SECRET_PATH to fetch the key from Vault.');
  process.exit(2);
}

async function readKey() {
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    const filePath = path.resolve(process.cwd(), process.env.ADMIN_PRIVATE_KEY_FILE);
    try {
      try { const st = await fsPromises.stat(filePath); if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) { throw new Error('private key file permissions are too open'); } } catch (_) {}
      return (await fsPromises.readFile(filePath, 'utf8')).trim();
    } catch (e) {
      throw new Error('Failed to read ADMIN_PRIVATE_KEY_FILE: ' + (e && e.message ? e.message : e));
    }
  }

  if (process.env.ADMIN_PRIVATE_KEY) return process.env.ADMIN_PRIVATE_KEY.trim();

  if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN) {
    const secretPath = process.env.VAULT_SECRET_PATH || '/secret/data/admin';
    const secretKey = process.env.VAULT_SECRET_KEY || 'privateKey';
    return await vaultFetch(process.env.VAULT_ADDR, process.env.VAULT_TOKEN, secretPath, secretKey);
  }

  // Fallback: look for repo-root admin.key file
  try {
    const repoRootKey = path.resolve(path.join(process.cwd(), 'admin.key'));
    if (fs.existsSync(repoRootKey)) {
      return (await fsPromises.readFile(repoRootKey, 'utf8')).trim();
    }
  } catch (e) {}

  throw new Error('No admin private key configured. Set ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY_FILE or configure Vault, or place admin.key in repo root.');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file || !args.outFile) return usage();

  let key;
  try { key = await readKey(); } catch (e) { console.error(e.message || e); process.exit(3); }
  try {
    if (process.env && process.env.TESTING) {
      try {
        let hasSecp = false;
        try {
          // ESM: use createRequire to emulate require.resolve
          const { createRequire } = await import('module');
          const req = createRequire(import.meta.url);
          try { req.resolve('secp256k1'); hasSecp = true; } catch (e) { hasSecp = false; }
        } catch (e) { hasSecp = false; }
        const k = key ? String(key).trim() : '';
        const forced = process && process.env && process.env.SUPPORT_NOBLE_SECP === '1';
        console.error('TESTING_CLI_ENV node=' + (process && process.versions && process.versions.node) + ' secp256k1=' + String(hasSecp) + ' force_noble=' + String(forced));
        console.error('TESTING_CLI_KEY=' + JSON.stringify({ startsWith0x: k.startsWith('0x'), len: k.length }));
      } catch (e) {}
    }
  } catch (e) {}

  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), args.file), 'utf8');
    const plain = await decryptEvidencePayload(raw, key);
    fs.writeFileSync(path.resolve(process.cwd(), args.outFile), plain, 'utf8');
    process.exit(0);
  } catch (e) {
    console.error('Decrypt CLI error:', e && e.message ? e.message : e);
    process.exit(4);
  }
}

// If invoked directly run main()
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
