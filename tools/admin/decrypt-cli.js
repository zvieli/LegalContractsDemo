#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import fsPromises from 'fs/promises';
import http from 'http';
import https from 'https';
import { decryptEvidencePayload } from './decryptHelper.js';
import { fetchFromVault as vaultFetch } from './vaultClient.js';

function usage() {
  console.error('Usage: node decrypt-cli.js [--file <cipherFile>]');
  console.error('  The admin private key is read from the environment variable `ADMIN_PRIVATE_KEY`.');
  console.error('  Alternatively, set `VAULT_ADDR` and `VAULT_TOKEN` and `VAULT_SECRET_PATH` to fetch the key from HashiCorp Vault.');
  console.error('  If --file is omitted the CLI reads ciphertext JSON from stdin.');
  process.exit(2);
}

// (Vault fetching is implemented in tools/admin/vaultClient.js and imported as `vaultFetch`)

async function main() {
  const argv = process.argv.slice(2);
    let file = null;
    let outFile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i+1]) { file = argv[++i]; }
      else if ((a === '--out-file' || a === '-o') && argv[i+1]) { outFile = argv[++i]; }
    else if (a === '--help' || a === '-h') { usage(); }
    else { usage(); }
  }

  // Read key from file, environment, or Vault (in that order)
  let key = null;
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    // Read key from file path; check permissions where possible
    const filePath = path.resolve(process.cwd(), process.env.ADMIN_PRIVATE_KEY_FILE);
    try {
      // POSIX permission checks: ensure file is not world/group readable/writable
      // On Windows this is a best-effort check: we skip chmod checks but still read.
      try {
        const st = await fsPromises.stat(filePath);
        // Enforce owner-only permissions only on POSIX systems (skip on Windows)
        if (process.platform !== 'win32' && typeof st.mode === 'number' && (st.mode & 0o077) !== 0) {
          console.error(`Private key file ${filePath} permissions are too open. Please set owner-only permissions.`);
          process.exit(4);
        }
      } catch (e) {
        // stat failed; continue to try reading the file which will produce its own error
      }
      key = (await fsPromises.readFile(filePath, 'utf8')).trim();
    } catch (e) {
      console.error('Failed to read ADMIN_PRIVATE_KEY_FILE:', e && e.message ? e.message : e);
      process.exit(5);
    }
  } else if (process.env.ADMIN_PRIVATE_KEY) {
    key = process.env.ADMIN_PRIVATE_KEY.trim();
  } else if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN) {
    const secretPath = process.env.VAULT_SECRET_PATH || '/secret/data/admin';
    const secretKey = process.env.VAULT_SECRET_KEY || 'privateKey';
    try {
      key = await vaultFetch(process.env.VAULT_ADDR, process.env.VAULT_TOKEN, secretPath, secretKey);
    } catch (e) {
      console.error('Failed to fetch admin key from Vault:', e && e.message ? e.message : e);
      process.exit(3);
    }
  } else {
    console.error('No admin private key found. Set ADMIN_PRIVATE_KEY or configure VAULT_ADDR and VAULT_TOKEN.');
    usage();
  }

  let payloadStr;
  if (file) {
    const p = path.resolve(process.cwd(), file);
    payloadStr = fs.readFileSync(p, 'utf8');
  } else {
    // read from stdin
    payloadStr = '';
    const stdin = process.stdin;
    stdin.setEncoding('utf8');
    for await (const chunk of stdin) {
      payloadStr += chunk;
    }
    payloadStr = payloadStr.trim();
  }

  try {
    // Diagnostic: surface that we have a key (don't print full key in prod)
    try { console.error('DEBUG_CLI_KEY_PRESENT len=' + (key ? String(key).length : 0)); } catch (e) {}

    // decrypt the payload using the provided admin key
    console.error('DEBUG_CLI_DECRYPT_START');
    let plain;
    try {
      // diagnostic: inspect payloadStr and cipher parts
      try {
        const parsed = JSON.parse(payloadStr);
        const cipher = parsed && parsed.crypto ? parsed.crypto : parsed;
        if (cipher) {
          try { console.error('DEBUG_CLI_CIPHER ephemPublicKey_len=' + (cipher.ephemPublicKey ? cipher.ephemPublicKey.length : 'null')); } catch (e) {}
          try { console.error('DEBUG_CLI_CIPHER iv_len=' + (cipher.iv ? cipher.iv.length : 'null')); } catch (e) {}
          try { console.error('DEBUG_CLI_CIPHER ciphertext_len=' + (cipher.ciphertext ? cipher.ciphertext.length : 'null')); } catch (e) {}
          try { console.error('DEBUG_CLI_CIPHER mac_len=' + (cipher.mac ? cipher.mac.length : 'null')); } catch (e) {}
        }
      } catch (e) {
        console.error('DEBUG_CLI_PARSE_PAYLOAD_FAILED', e && e.message ? e.message : e);
      }

      plain = await decryptEvidencePayload(payloadStr, key);
      console.error('DEBUG_CLI_DECRYPT_OK');
    } catch (e) {
      throw e;
    }

    // Print JSON output wrapped in markers so tests can reliably extract it despite warnings
    if (outFile) {
      try {
        // write synchronously to ensure child process doesn't exit before data flushed
        const outPath = path.resolve(process.cwd(), outFile);
        fs.writeFileSync(outPath, String(plain), 'utf8');
        process.stdout.write('WROTE_OUT_FILE\n');
        console.error('DEBUG_CLI_WROTE_OUTFILE ' + outPath);
        process.exit(0);
      } catch (e) {
        console.error('Failed to write out-file:', e && e.message ? e.message : e);
        process.exit(2);
      }
    }

    // default: print plaintext to stdout
    process.stdout.write(String(plain) + '\n');
  } catch (e) {
    console.error('Decryption failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  // script invoked directly (node path/to/decrypt-cli.js)
  main();
}
