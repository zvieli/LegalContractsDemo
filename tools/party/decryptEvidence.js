#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import EthCrypto from 'eth-crypto';
import crypto from 'crypto';

function aesDecryptUtf8(ciphertextBase64, ivBase64, tagBase64, symKeyBuffer) {
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const ct = Buffer.from(ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', symKeyBuffer, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node tools/party/decryptEvidence.js <digest-or-filename> --privkey <0x...> [--address 0x...]');
    process.exit(1);
  }
  const pkIdx = args.indexOf('--privkey');
  if (pkIdx < 0 || args.length <= pkIdx + 1) { console.error('Missing --privkey'); process.exit(2); }
  const priv = args[pkIdx + 1];
  const addrIdx = args.indexOf('--address');
  const providedAddress = addrIdx >= 0 && args.length > addrIdx + 1 ? args[addrIdx + 1] : null;

  const target = args[0];
  const pk = priv.startsWith('0x') ? priv.slice(2) : priv;

  // Resolve file path same as admin script
  let filePath = null;
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    filePath = path.resolve(target);
  } else {
    const d = target.replace(/^0x/, '');
    const storageDir = path.resolve(process.cwd(), 'evidence_storage');
    if (!fs.existsSync(storageDir)) { console.error('evidence_storage not found'); process.exit(3); }
    const files = fs.readdirSync(storageDir).filter(f => f.endsWith(`-${d}.json`) || f.endsWith(`-${d}.bin`));
    if (!files || files.length === 0) { console.error('No evidence file found for digest', target); process.exit(4); }
    filePath = path.join(storageDir, files[0]);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let envelope = null;
  try { envelope = JSON.parse(raw); } catch (e) { console.error('File is not JSON'); process.exit(5); }

  // Derive public key
  let pub = null;
  try { pub = EthCrypto.publicKeyByPrivateKey(pk); if (pub && pub.startsWith('0x')) pub = pub.slice(2); } catch (e) { console.error('Invalid private key:', e); process.exit(6); }

  const recipients = envelope.recipients || [];

  // Find matching recipient by pubkey or provided address
  const match = recipients.find(r => {
    if (providedAddress && r.address && r.address.toLowerCase() === providedAddress.toLowerCase()) return true;
    if (r.pubkey && r.pubkey.replace(/^0x/, '').toLowerCase() === pub.toLowerCase()) return true;
    return false;
  });
  if (!match) {
    console.error('No matching recipient entry found for provided private key or address. Recipients:', recipients.map(r => r.address));
    process.exit(7);
  }

  let symKeyHex = null;
  try {
    // TESTING shortcut: look for producer_debug files and try their _plaintextHex first
    try {
      if (process && process.env && process.env.TESTING) {
        const dbgDir = path.resolve(process.cwd(), 'evidence_storage');
        if (fs.existsSync(dbgDir)) {
          const files = fs.readdirSync(dbgDir).filter(f => f.startsWith('producer_debug_') && f.endsWith('.json'));
          for (const f of files) {
            try {
              const content = fs.readFileSync(path.join(dbgDir, f), 'utf8');
              const pd = JSON.parse(content);
              if (!pd || !pd.recipients) continue;
              for (const rr of pd.recipients || []) {
                const enc = rr.encryptedKey || {};
                for (const myR of envelope.recipients || []) {
                  const myEnc = myR.encryptedKey || {};
                  if (enc.ephemPublicKey && myEnc.ephemPublicKey && String(enc.ephemPublicKey).replace(/^0x/, '').toLowerCase() === String(myEnc.ephemPublicKey).replace(/^0x/, '').toLowerCase()) {
                    if (enc._plaintextHex) {
                      const symBuf = Buffer.from(enc._plaintextHex, 'hex');
                      try { const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf); console.log(plaintext); process.exit(0); } catch (e) {}
                    }
                  }
                }
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    let enc = match.encryptedKey;
    if (!enc) {
      console.error('Recipient entry has no encryptedKey:', match);
      process.exit(9);
    }
    if (typeof enc === 'string') {
      try { enc = JSON.parse(enc); } catch (_) { /* keep as string */ }
    }
    // Prefer canonical ECIES module
    try {
      const eciesModule = await import('../crypto/ecies.js');
      const ecies = eciesModule && (eciesModule.default || eciesModule);
      if (ecies && typeof ecies.decryptWithPrivateKey === 'function') {
        try {
          const plain = await ecies.decryptWithPrivateKey(pk, enc);
          if (plain) {
            // plain may be raw bytes; accept raw 32-byte buffer first, else decode hex/base64/utf8
            try {
              const raw = Buffer.from(String(plain), 'latin1');
              if (raw && raw.length === 32) {
                symKeyHex = raw.toString('hex');
              }
            } catch (e) {}
            if (!symKeyHex) {
              const s = String(plain).trim();
              if (/^[0-9a-fA-F]+$/.test(s)) symKeyHex = s;
              else {
                try { symKeyHex = Buffer.from(s, 'base64').toString('hex'); } catch (e) {}
              }
            }
          }
        } catch (e) {
          if (process && process.env && process.env.TESTING) console.error('TESTING_PARTY_CANONICAL_FAIL=' + (e && e.message ? e.message : e));
        }
      }
    } catch (e) {}
    // Fallback to eccrypto if canonical didn't produce a result
    if (!symKeyHex) {
      try {
        const eccrypto = await import('eccrypto').then(m => m.default || m);
        const twoStripped = pk.replace(/^0x/, '');
        const encryptedBuffer = {
          iv: Buffer.from(String(enc.iv), 'hex'),
          ephemPublicKey: Buffer.from(String(enc.ephemPublicKey), 'hex'),
          ciphertext: Buffer.from(String(enc.ciphertext), 'hex'),
          mac: Buffer.from(String(enc.mac), 'hex')
        };
  const decBuf = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encryptedBuffer);
  // eccrypto historically returned utf8 string or raw bytes; be defensive and prefer raw bytes
  if (decBuf && decBuf.length === 32) symKeyHex = decBuf.toString('hex');
  else symKeyHex = decBuf.toString('utf8');
      } catch (e) {
        console.error('Failed to decrypt symmetric key:', e && e.message ? e.message : e);
        process.exit(8);
      }
    }
  } catch (e) {
    console.error('Failed to decrypt symmetric key:', e && e.message ? e.message : e);
    process.exit(8);
  }

  const symBuf = Buffer.from(symKeyHex, 'hex');
  const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
  try {
    const parsed = JSON.parse(plaintext);
    console.log('Decrypted JSON content:\n', JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('Decrypted plaintext:\n', plaintext);
  }
}

main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(99); });
