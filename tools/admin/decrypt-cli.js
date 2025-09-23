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

async function fetchFromVault(vaultAddr, vaultToken, secretPath, secretKey = 'privateKey') {
  // Construct Vault API path for KV v2 by convention: /v1/<mount>/data/<path>
  // Allow users to pass either full API path or a mount/path like secret/data/admin.
  let url = vaultAddr;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  // If secretPath already contains /v1/ treat it as full URL
  if (!/\/v1\//.test(secretPath)) {
    // default to KV v2 at mount `secret` if only a short path provided
    if (!secretPath.startsWith('/')) secretPath = '/' + secretPath;
    secretPath = `/v1${secretPath}`;
  }
  const fullUrl = new URL(secretPath, url).toString();

  const lib = fullUrl.startsWith('https://') ? https : http;
  const opts = {
    method: 'GET',
    headers: {
      'X-Vault-Token': vaultToken,
      'Accept': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(fullUrl, opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`Vault responded with status ${res.statusCode}: ${data}`));
        }
        try {
          const obj = JSON.parse(data);
          // For KV v2 the secret is in obj.data.data
          const v2 = obj && obj.data && obj.data.data ? obj.data.data : null;
          const val = v2 && v2[secretKey] ? v2[secretKey] : (obj && obj.data && obj.data[secretKey] ? obj.data[secretKey] : null);
          if (!val) return reject(new Error('Secret key not found in Vault response'));
          resolve(val);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i+1]) { file = argv[++i]; }
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
        // If running on POSIX, ensure mode & 0o077 === 0
        if (typeof st.mode === 'number' && (st.mode & 0o077) !== 0) {
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
    const plain = await decryptEvidencePayload(payloadStr, key);
    console.log(plain);
  } catch (e) {
    console.error('Decryption failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
