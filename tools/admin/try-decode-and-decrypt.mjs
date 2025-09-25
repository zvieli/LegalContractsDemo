#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

async function readInput(file) {
  if (!file || file === '-') {
    const stdin = await fs.readFile(0);
    return stdin.toString('utf8');
  }
  // If looks like a URL, fetch it
  if (/^https?:\/\//i.test(file)) {
    if (typeof fetch === 'undefined') {
      // Node v18+ provides global fetch; otherwise instruct user
      throw new Error('fetch not available in this Node runtime. Please download the file locally and pass the path instead.');
    }
    const res = await fetch(file);
    if (!res.ok) throw new Error('Failed to fetch URL: ' + res.status + ' ' + res.statusText);
    return await res.text();
  }
  const p = path.resolve(process.cwd(), file);
  return await fs.readFile(p, 'utf8');
}

function looksLikeHex(s) {
  const t = s.replace(/^0x/i, '').trim();
  return /^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0;
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function tryUtf8FromHex(s) {
  const t = s.replace(/^0x/i, '').trim();
  try {
    const buf = Buffer.from(t, 'hex');
    return buf.toString('utf8');
  } catch (e) {
    return null;
  }
}

function tryUtf8FromBase64(s) {
  try {
    const buf = Buffer.from(s, 'base64');
    // Heuristic: if decoded contains many non-printables, probably not base64 of JSON
    return buf.toString('utf8');
  } catch (e) {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log('Usage: node try-decode-and-decrypt.mjs <file|URL|->');
    console.log('  file - path to file containing the blob or JSON');
    console.log('  URL  - https://... to fetch');
    console.log('  -    - read from stdin');
    process.exit(1);
  }

  const inputPath = argv[0];
  let raw;
  try {
    raw = await readInput(inputPath);
  } catch (e) {
    console.error('Failed reading input:', e.message || e);
    process.exit(2);
  }

  raw = raw.trim();

  // Try JSON
  const asJson = tryParseJson(raw);
  if (asJson) {
    console.log('Detected: JSON');
    await handleJson(asJson, raw);
    return;
  }

  // Try hex -> utf8 -> json
  if (looksLikeHex(raw)) {
    const utf = tryUtf8FromHex(raw);
    if (utf) {
      const j = tryParseJson(utf);
      if (j) {
        console.log('Detected: hex encoding of JSON');
        await handleJson(j, utf);
        return;
      }
    }
  }

  // Try base64
  const b64 = tryUtf8FromBase64(raw);
  if (b64) {
    const j = tryParseJson(b64);
    if (j) {
      console.log('Detected: base64 encoding of JSON');
      await handleJson(j, b64);
      return;
    }
  }

  // Not JSON - show diagnostics & sample of content
  console.log('Could not detect eth-crypto JSON in the provided blob.');
  console.log('Sample (first 400 chars):\n');
  console.log(raw.slice(0, 400));
  console.log('\n---\nHints:');
  console.log('- If the ciphertext is an eth-crypto JSON object, paste the exact JSON string (no reformatting).');
  console.log('- If you have a URL, pass it as the argument (https://...), or download the file and pass the local path.');
  console.log('- If you think it is hex or base64, this tool attempted both but could not parse JSON after decoding.');
  console.log('- If you want me to try decrypting, set ADMIN_PRIVATE_KEY in your local environment and run again; the script will attempt decryption if the JSON matches eth-crypto format.');
  process.exit(3);
}

async function handleJson(obj, rawText) {
  // Check required eth-crypto fields
  const hasEC = obj && obj.iv && obj.ephemPublicKey && obj.ciphertext && obj.mac;
  if (!hasEC) {
    console.log('JSON parsed but does not contain expected eth-crypto fields (iv, ephemPublicKey, ciphertext, mac).');
    console.log('Parsed keys:', Object.keys(obj).join(', '));
    return;
  }

  console.log('eth-crypto JSON detected.');
  let ethers;
  try {
    ethers = await import('ethers');
  } catch (e) {
    console.warn('ethers not available; skipping digest computation. To compute digest, install ethers in this project.');
  }
  if (ethers) {
    try {
      const digest = ethers.ethers ? ethers.ethers.keccak256(ethers.ethers.toUtf8Bytes(rawText)) : ethers.keccak256(ethers.toUtf8Bytes(rawText));
      console.log('Computed keccak256 digest of exact JSON string:');
      console.log(digest);
    } catch (e) {
      console.warn('Failed computing digest:', e.message || e);
    }
  }

  // Optionally decrypt if ADMIN_PRIVATE_KEY is set
  const adminPk = process.env.ADMIN_PRIVATE_KEY || process.env.ADMIN_KEY || '';
  if (!adminPk) {
    console.log('\nSet ADMIN_PRIVATE_KEY in the environment to attempt decryption locally.');
    return;
  }

  console.log('\nADMIN_PRIVATE_KEY provided - attempting local decrypt (will not transmit key anywhere).');
  let EthCrypto;
  try {
    const mod = await import('eth-crypto');
    EthCrypto = mod.default || mod;
  } catch (e) {
    console.error('eth-crypto not installed in this environment. Run `npm install eth-crypto` in the project or global env.');
    process.exit(4);
  }

  const pk = adminPk.replace(/^0x/, '');
  try {
    const plain = await EthCrypto.decryptWithPrivateKey(pk, obj);
    console.log('\nDecryption succeeded. Plaintext:');
    console.log(plain);
  } catch (e) {
    console.error('Decryption failed:', e?.message || e);
    process.exit(5);
  }
}

main().catch(e => { console.error('Unhandled error:', e); process.exit(99); });
