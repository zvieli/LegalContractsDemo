#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Thin CLI wrapper around canonical ECIES implementation
async function loadEcies() {
  const mod = await import('./crypto/ecies.js');
  return mod && (mod.default || mod);
}

async function encryptCommand(pubkey, plaintext) {
  const ecies = await loadEcies();
  if (!ecies || typeof ecies.encryptWithPublicKey !== 'function') {
    console.error('Canonical ECIES module not available');
    process.exit(2);
  }
  const out = await ecies.encryptWithPublicKey(pubkey, plaintext);
  console.log(JSON.stringify(out));
}

async function decryptCommand(privkey, encPathOrJson) {
  const ecies = await loadEcies();
  if (!ecies || typeof ecies.decryptWithPrivateKey !== 'function') {
    console.error('Canonical ECIES module not available');
    process.exit(2);
  }
  let enc = null;
  try {
    // If encPathOrJson is a path to a file, read it
    if (fs.existsSync(encPathOrJson)) {
      const raw = fs.readFileSync(encPathOrJson, 'utf8');
      enc = JSON.parse(raw);
    } else {
      enc = JSON.parse(encPathOrJson);
    }
  } catch (e) {
    console.error('Failed to read encrypted input:', e && e.message ? e.message : e);
    process.exit(3);
  }
  try {
    const plain = await ecies.decryptWithPrivateKey(privkey, enc);
    console.log(String(plain));
  } catch (e) {
    console.error('Decrypt failed:', e && e.message ? e.message : e);
    process.exit(4);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args || args.length === 0) {
    console.error('Usage: cli.js encrypt <pubkey> <plaintext>\n       cli.js decrypt <privkey> <encJsonOrFile>');
    process.exit(1);
  }
  const cmd = args[0];
  if (cmd === 'encrypt') {
    if (args.length < 3) { console.error('encrypt requires <pubkey> <plaintext>'); process.exit(1); }
    await encryptCommand(args[1], args[2]);
  } else if (cmd === 'decrypt') {
    if (args.length < 3) { console.error('decrypt requires <privkey> <encJsonOrFile>'); process.exit(1); }
    await decryptCommand(args[1], args[2]);
  } else {
    console.error('Unknown command', cmd); process.exit(1);
  }
}

if (import.meta.url && process.argv[1] && process.argv[1].endsWith('cli.js')) {
  main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(99); });
}

export default { encryptCommand, decryptCommand };
