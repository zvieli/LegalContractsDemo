import fs from 'fs';
import path from 'path';
import ecies from '../crypto/ecies.js';
import crypto from 'crypto';

const root = process.cwd();
const dbgPath = path.join(root, 'evidence_storage', 'last_cli_debug.json');
const raw = fs.readFileSync(dbgPath, 'utf8');
const j = JSON.parse(raw.replace(/```json\n|```/g, ''));

const envelope = j.envelope;
const adminPriv = j.adminPriv;

async function tryUnwrap() {
  try {
    const recip = envelope.recipients[0].encryptedKey;
    console.log('recipient.encryptedKey:', recip);
    const plain = await ecies.decryptWithPrivateKey(adminPriv, recip);
    console.log('ecies decrypted plaintext:', plain);

    // try to interpret plaintext as hex key
    const keyHex = String(plain).trim();
    let keyBuf;
    if (/^[0-9a-fA-F]+$/.test(keyHex)) {
      keyBuf = Buffer.from(keyHex, 'hex');
      console.log('interpreting plaintext as hex key, len=', keyBuf.length);
    } else {
      // try base64
      try { keyBuf = Buffer.from(keyHex, 'base64'); console.log('interpreting plaintext as base64 key, len=', keyBuf.length); } catch (e) {}
    }

    // decrypt envelope AES-GCM ciphertext if possible
    if (!envelope.encryption || !envelope.encryption.aes) {
      console.log('no aes envelope to attempt');
      return;
    }
    const aes = envelope.encryption.aes;
    // aes.iv and aes.tag look like base64 in artefact
    const iv = Buffer.from(aes.iv, 'base64');
    const tag = Buffer.from(aes.tag, 'base64');
    const ct = Buffer.from(envelope.ciphertext, 'base64');

    if (!keyBuf) {
      console.log('no symmetric key buffer recovered, aborting aes test');
      return;
    }

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const out = Buffer.concat([decipher.update(ct), decipher.final()]);
      console.log('AES-GCM decrypt succeeded, plaintext:', out.toString('utf8'));
    } catch (e) {
      console.error('AES-GCM decrypt failed:', e && e.message);
    }
  } catch (err) {
    console.error('ecies unwrap failed:', err && err.message);
  }
}

tryUnwrap();
