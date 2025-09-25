#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { decryptEvidencePayload } from './decryptHelper.js';
import { keccak256, toUtf8Bytes } from 'ethers';
import { JsonRpcProvider } from 'ethers';

function usage() {
  console.error(`Usage:
  node fetch-and-decrypt.js --digest <0x...> --fetchUrl <https://.../cipher.json> [--out file]
  node fetch-and-decrypt.js --digest <0x...> --fetchBase <https://host/path> [--out file]
  node fetch-and-decrypt.js --contract <address> --caseId <n> --rpc <rpcUrl> --fetchBase <https://host/path>
  or: cat ciphertext.json | node fetch-and-decrypt.js --stdin --digest <0x...>

Options:
  --digest     bytes32 digest (hex) to verify against ciphertext
  --contract   contract address to read dispute digest from (requires --caseId)
  --caseId     dispute/case id (uint)
  --rpc        JSON-RPC URL for chain (default http://localhost:8545)
  --fetchUrl   exact HTTPS URL to fetch ciphertext
  --fetchBase  base URL; script will try <base>/<digestNo0x>.json
  --file       local ciphertext file path
  --stdin      read ciphertext JSON from stdin
  --out        output plaintext file (defaults to stdout)
`);
  process.exit(2);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--digest' && argv[i+1]) opts.digest = argv[++i];
    else if (a === '--contract' && argv[i+1]) opts.contract = argv[++i];
    else if (a === '--caseId' && argv[i+1]) opts.caseId = argv[++i];
    else if (a === '--rpc' && argv[i+1]) opts.rpc = argv[++i];
    else if (a === '--fetchUrl' && argv[i+1]) opts.fetchUrl = argv[++i];
    else if (a === '--fetchBase' && argv[i+1]) opts.fetchBase = argv[++i];
    else if (a === '--file' && argv[i+1]) opts.file = argv[++i];
    else if (a === '--stdin') opts.stdin = true;
    else if (a === '--out' && argv[i+1]) opts.out = argv[++i];
    else usage();
  }
  return opts;
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

async function tryFetch(url) {
  // Use global fetch if available (Node 18+), otherwise fallback to https
  if (typeof fetch === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
    return await res.text();
  }
  // fallback
  return new Promise((resolve, reject) => {
    import('https').then(({ get }) => {
      get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error('Fetch failed status ' + res.statusCode));
        let data = '';
        res.setEncoding('utf8');
        res.on('data', d => data += d);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    }).catch(reject);
  });
}

async function main() {
  const opts = parseArgs();
  const rpc = opts.rpc || 'http://localhost:8545';

  // Determine digest either from flag or from contract/caseId
  let digest = opts.digest || null;
  if (!digest && opts.contract && (typeof opts.caseId !== 'undefined')) {
    const provider = new JsonRpcProvider(rpc);
    const addr = opts.contract;
    const abi = [
      'function getDispute(uint256) view returns (address,uint8,uint256,bytes32,bool,bool,uint256)',
      'function getDisputeDigest(uint256) view returns (bytes32)'
    ];
    const c = new (await import('ethers')).Contract(addr, abi, provider);
    try {
      digest = await c.getDisputeDigest(Number(opts.caseId));
    } catch (e) {
      try {
        const d = await c.getDispute(Number(opts.caseId));
        // assume evidence is index 3
        digest = d[3];
      } catch (ee) {
        console.error('Failed reading digest from contract:', ee?.message || ee);
        process.exit(3);
      }
    }
  }

  if (!digest) {
    console.error('No digest provided and no contract/caseId resolved.');
    usage();
  }

  // Normalize digest
  if (typeof digest === 'string') digest = digest.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) {
    console.error('Digest must be a 32-byte hex (0x...)');
    process.exit(4);
  }

  // Obtain ciphertext
  let ciphertextRaw = null;
  if (opts.stdin) {
    ciphertextRaw = (await readStdin()).trim();
  } else if (opts.file) {
    ciphertextRaw = (await fs.readFile(path.resolve(process.cwd(), opts.file), 'utf8')).trim();
  } else if (opts.fetchUrl) {
    ciphertextRaw = (await tryFetch(opts.fetchUrl)).trim();
  } else if (opts.fetchBase) {
    const base = opts.fetchBase.replace(/\/$/, '');
    const url = `${base}/${digest.replace(/^0x/, '')}.json`;
    console.error('Attempting to fetch ciphertext from', url);
    ciphertextRaw = (await tryFetch(url)).trim();
  } else {
    console.error('No fetch/source specified for ciphertext (use --file, --fetchUrl, --fetchBase or --stdin).');
    usage();
  }

  if (!ciphertextRaw) {
    console.error('Empty ciphertext received');
    process.exit(5);
  }

  // Compute keccak256 over the raw exact ciphertext bytes (UTF-8)
  const computed = keccak256(toUtf8Bytes(ciphertextRaw));
  if (computed !== digest) {
    console.error(`Digest mismatch! on-chain: ${digest} computed: ${computed}`);
    console.error('Aborting to avoid decrypting mismatched ciphertext. If you are sure this is the correct file, double-check serialization (no pretty-printing).');
    process.exit(6);
  }

  // Read admin private key from env or file
  let adminKey = null;
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    try { adminKey = (await fs.readFile(process.env.ADMIN_PRIVATE_KEY_FILE, 'utf8')).trim(); } catch (e) { console.error('Failed reading ADMIN_PRIVATE_KEY_FILE:', e?.message||e); process.exit(7); }
  } else if (process.env.ADMIN_PRIVATE_KEY) {
    adminKey = process.env.ADMIN_PRIVATE_KEY.trim();
  } else {
    console.error('No admin private key configured. Set ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY_FILE in the environment.');
    process.exit(8);
  }

  // Attempt decryption using existing decrypt helper
  try {
    const plaintext = await decryptEvidencePayload(ciphertextRaw, adminKey);
    if (opts.out) {
      await fs.writeFile(path.resolve(process.cwd(), opts.out), plaintext, 'utf8');
      console.error('Decrypted plaintext written to', opts.out);
    } else {
      console.log(plaintext);
    }
  } catch (e) {
    console.error('Decryption failed:', e?.message || e);
    process.exit(9);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('Fatal:', e); process.exit(10); });
}
