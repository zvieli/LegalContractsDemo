#!/usr/bin/env node
// Enhanced decryptEvidence: supports legacy placeholder and AES-256-GCM + ECIES multi-recipient envelopes.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import EthCrypto from 'eth-crypto';

function usage(){
  console.error('Usage: decryptEvidence.js <envelopePath> --privkey <hexPrivKey>');
  process.exit(1);
}

const args = process.argv.slice(2);
if(args.length < 3) usage();
const envFile = args[0];
const pkIndex = args.indexOf('--privkey');
if(pkIndex === -1 || pkIndex+1 >= args.length){ usage(); }
let privKey = args[pkIndex+1];
if(privKey.startsWith('0x')) privKey = privKey.slice(2);

const fullPath = path.isAbsolute(envFile) ? envFile : path.join(process.cwd(), envFile);
if(!fs.existsSync(fullPath)){
  console.error('Envelope file not found:', fullPath);
  process.exit(2);
}

const raw = fs.readFileSync(fullPath,'utf8');
let envelope;
try { envelope = JSON.parse(raw); } catch(e){ console.error('Invalid JSON envelope'); process.exit(3); }

async function tryDecryptRecipient(rec){
  let encryptedKey = rec.encryptedKey;
  if(typeof encryptedKey === 'string') { try { encryptedKey = JSON.parse(encryptedKey); } catch(_){} }
  if(encryptedKey && encryptedKey.ciphertext === 'legacy') {
    return Buffer.from(envelope.ciphertext,'base64').toString('utf8');
  }
  const symHex = await EthCrypto.decryptWithPrivateKey(privKey, encryptedKey);
  const symBuf = Buffer.from(symHex.replace(/^0x/, ''),'hex');
  if(symBuf.length !== 32) throw new Error('invalid symmetric key length');
  const ivB64 = envelope.encryption?.aes?.iv; const tagB64 = envelope.encryption?.aes?.tag;
  if(!ivB64 || !tagB64) throw new Error('missing iv/tag');
  const decipher = crypto.createDecipheriv('aes-256-gcm', symBuf, Buffer.from(ivB64,'base64'), {authTagLength:16});
  decipher.setAuthTag(Buffer.from(tagB64,'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext,'base64')),
    decipher.final()
  ]).toString('utf8');
}

(async () => {
  try {
    const recipients = envelope.recipients || [];
    if(!recipients.length) throw new Error('No recipients');
    let lastErr = null;
    for(const r of recipients){
      try {
        const plaintext = await tryDecryptRecipient(r);
        console.log(JSON.stringify({ ok:true, recipient:r.pubkey||r.address||'unknown', decrypted: plaintext.slice(0, 5000) }, null, 2));
        process.exit(0);
      } catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('All recipient decrypt attempts failed');
  } catch(e){
    console.error('Decrypt failed:', e.message || e);
    process.exit(4);
  }
})();
