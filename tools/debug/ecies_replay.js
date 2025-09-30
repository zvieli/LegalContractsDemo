import fs from 'fs';
import path from 'path';
import * as secp from '@noble/secp256k1';
import crypto from 'crypto';

function strip0x(s) { if (!s && s !== 0) return s; let t = String(s).trim(); if (t.startsWith('0x')) t = t.slice(2); return t; }
function hexToBuf(h) { if (!h) return Buffer.alloc(0); return Buffer.from(strip0x(h), 'hex'); }

const dbgDir = path.resolve(process.cwd(), 'evidence_storage');
const last = JSON.parse(fs.readFileSync(path.join(dbgDir, 'last_cli_debug.json'), 'utf8'));
const rawbytes = JSON.parse(fs.readFileSync(path.join(dbgDir, 'last_cli_rawbytes.json'), 'utf8'));
console.log('Loaded last_cli_debug.json file:', last.file);
const adminPriv = String(last.adminPriv).replace(/^0x/, '');
const adminPrivBuf = hexToBuf(adminPriv);
const rec = rawbytes.recipients[0];
const encHex = rec.encryptedKey_hex;
console.log('enc iv', encHex.iv, 'ct', encHex.ciphertext.slice(0,64)+'...', 'tag', encHex.mac);

// find producer_debug that matches ephemPublicKey
const ephem = String(encHex.ephemPublicKey).replace(/^0x/, '').toLowerCase();
let found = null;
const files = fs.readdirSync(dbgDir).filter(f => f.startsWith('producer_debug_') && f.endsWith('.json'));
for (const f of files) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dbgDir, f), 'utf8'));
    if (!doc || !Array.isArray(doc.recipients)) continue;
    for (const r of doc.recipients) {
      const rEp = (r.encryptedKey && (r.encryptedKey.ephemPublicKey || r.encryptedKey.ephemPublicKey)) || r.ephemPublicKey || null;
      if (!rEp) continue;
      if (String(rEp).replace(/^0x/, '').toLowerCase() === ephem) { found = { doc, r }; break; }
    }
    if (found) break;
  } catch (e) {}
}

if (!found) {
  console.error('No matching producer_debug found for ephem', ephem);
  process.exit(2);
}

const prod = found.r;
const producerDoc = found.doc;
const ephPriv = (prod.encryptedKey && prod.encryptedKey._ephemeralPrivate) || prod._ephemeralPrivate || producerDoc._ephemeralPrivate || null;
const symHex = producerDoc.symKey || producerDoc.symKeyHex || null;
console.log('producer ephPriv:', ephPriv);
console.log('producer symKey (hex):', symHex);

// verify ephPriv -> ephemPublicKey
try {
  const ephPrivBuf2 = hexToBuf(ephPriv);
  const ephPubBuf = secp.getPublicKey(ephPrivBuf2, false);
  const ephPubHex = Buffer.from(ephPubBuf).toString('hex');
  console.log('recomputed ephPub hex:', ephPubHex);
  console.log('stored ephemPublicKey equals recomputed?', ephPubHex === String(encHex.ephemPublicKey).replace(/^0x/, '').toLowerCase());
} catch (e) {
  console.error('failed to recompute ephPub from ephPriv:', e && e.message);
}

if (!ephPriv || !symHex) {
  console.error('missing ephPriv or symKey in producer debug');
  process.exit(2);
}

// derive key as ecies does: shared = getSharedSecret(ephPriv, adminPub) but here we compute shared two ways
const ephPrivBuf = hexToBuf(ephPriv);
const adminPub = secp.getPublicKey(adminPrivBuf, false);
const sharedP = secp.getSharedSecret(ephPrivBuf, adminPub);
const last32p = Buffer.from(sharedP).slice(-32);
const kdfP = crypto.createHash('sha256').update(last32p).digest();

console.log('derived kdf (producer-side) hex:', kdfP.toString('hex'));

  // Re-encrypt the producer symKey plaintext with derived kdf and the stored IV, compare ct/tag
  try {
    const iv = hexToBuf(encHex.iv);
    // Check for producer-provided plaintext bytes (TESTING-only) and prefer them as ground truth
    const producerPlainHex = (prod.encryptedKey && prod.encryptedKey._plaintextHex) || producerDoc._plaintextHex || null;
    let rawHex = String(symHex).replace(/^0x/, '');
    let rawBytes = (() => { try { return Buffer.from(rawHex, 'hex'); } catch (e) { return null; } })();
    if (producerPlainHex) {
      try {
        rawHex = String(producerPlainHex).replace(/^0x/, '');
        rawBytes = Buffer.from(rawHex, 'hex');
        console.log('Using producer-provided plaintext hex for replay (length', rawBytes.length + ')');
      } catch (e) {
        console.error('Failed parsing producer plaintext hex:', e && e.message);
      }
    }
    const trials = [
      { name: 'utf8-hexstring', buf: Buffer.from(String(symHex), 'utf8') },
      { name: 'utf8-hexstring-lower', buf: Buffer.from(String(symHex).toLowerCase(), 'utf8') },
      { name: 'utf8-hexstring-upper', buf: Buffer.from(String(symHex).toUpperCase(), 'utf8') },
      { name: 'raw-bytes', buf: rawBytes },
      { name: 'raw-bytes-reversed', buf: rawBytes ? Buffer.from(rawBytes).reverse() : null },
      { name: '0x-prefixed-utf8', buf: Buffer.from('0x' + String(symHex), 'utf8') },
      { name: 'quoted-json', buf: Buffer.from(JSON.stringify(String(symHex)), 'utf8') },
      { name: 'quoted-plain', buf: Buffer.from('"' + String(symHex) + '"', 'utf8') },
      { name: 'utf16le-hexstring', buf: Buffer.from(String(symHex), 'utf16le') },
      { name: 'latin1-hexstring', buf: Buffer.from(String(symHex), 'latin1') },
      { name: 'hex-with-spaces', buf: Buffer.from(rawHex.replace(/(.{2})/g, '$1 ').trim(), 'utf8') },
      { name: 'hex-with-newline', buf: Buffer.from(rawHex + '\n', 'utf8') },
      { name: 'base64-of-raw', buf: (() => { try { return Buffer.from(Buffer.from(rawHex, 'hex').toString('base64'), 'utf8'); } catch (e) { return null; } })() },
      { name: 'base64-rawbytes', buf: (() => { try { return Buffer.from(rawBytes.toString('base64'), 'utf8'); } catch (e) { return null; } })() },
      { name: 'binary-utf8', buf: Buffer.from(rawBytes ? rawBytes.toString('binary') : '', 'binary') }
    ].filter(t => t && t.buf && t.buf.length > 0);

    for (const t of trials) {
      try {
        // try multiple AES key sizes in case legacy implementation used AES-128 or AES-192
        const keySizes = [16, 24, 32];
        for (const ks of keySizes) {
          try {
            const keyTry = kdfP.slice(0, ks);
            const cipher = crypto.createCipheriv(ks === 16 ? 'aes-128-gcm' : (ks === 24 ? 'aes-192-gcm' : 'aes-256-gcm'), keyTry, iv, { authTagLength: 16 });
            const ct = Buffer.concat([cipher.update(t.buf), cipher.final()]);
            const tag = cipher.getAuthTag();
            console.log(`re-encrypt trial ${t.name} keylen=${ks*8} produced ct hex (start):`, ct.toString('hex').slice(0,64)+'...');
            console.log(`re-encrypt trial ${t.name} keylen=${ks*8} produced tag hex:`, tag.toString('hex'));
            console.log(`stored ct hex (start):`, encHex.ciphertext.slice(0,64)+'...');
            console.log(`stored tag hex:`, encHex.mac);
            console.log(`${t.name} keylen=${ks*8} ct match?`, ct.toString('hex') === String(encHex.ciphertext).replace(/^0x/, '').toLowerCase());
            console.log(`${t.name} keylen=${ks*8} tag match?`, tag.toString('hex') === String(encHex.mac).replace(/^0x/, '').toLowerCase());
            // If we used the producer plaintext and got a match, exit success
            if (producerPlainHex && ct.toString('hex') === String(encHex.ciphertext).replace(/^0x/, '').toLowerCase() && tag.toString('hex') === String(encHex.mac).replace(/^0x/, '').toLowerCase()) {
              console.log('MATCH: re-encrypt of producer plaintext reproduced stored ciphertext and tag.');
              process.exit(0);
            }
          } catch (e) {
            console.error(`re-encrypt trial ${t.name} keylen=${ks*8} failed:`, e && e.message);
          }
        }
      } catch (e) {
        console.error(`re-encrypt trial ${t.name} failed:`, e && e.message);
      }
    }
  } catch (e) {
    console.error('re-encrypt failed', e && e.message);
  }

// Also try consumer-derived kdf (adminPriv + ephemPub) to confirm parity
try {
  const ephemBuf = hexToBuf(encHex.ephemPublicKey);
  const sharedC = secp.getSharedSecret(adminPrivBuf, ephemBuf);
  const last32c = Buffer.from(sharedC).slice(-32);
  const kdfC = crypto.createHash('sha256').update(last32c).digest();
  console.log('derived kdf (consumer-side) hex:', kdfC.toString('hex'));
  // encrypt with kdfC
  const iv = hexToBuf(encHex.iv);
  const plaintext = Buffer.from(String(symHex), 'utf8');
  const cipher2 = crypto.createCipheriv('aes-256-gcm', kdfC, iv, { authTagLength: 16 });
  const ct2 = Buffer.concat([cipher2.update(plaintext), cipher2.final()]);
  const tag2 = cipher2.getAuthTag();
  console.log('consumer re-encrypt ct match?', ct2.toString('hex') === String(encHex.ciphertext).replace(/^0x/, '').toLowerCase());
  console.log('consumer re-encrypt tag match?', tag2.toString('hex') === String(encHex.mac).replace(/^0x/, '').toLowerCase());
} catch (e) {
  console.error('consumer re-encrypt failed', e && e.message);
}

console.log('\nFinished replay checks.');

// --- Try the alternate crypto_hex blob if present (quick low-risk test) ---
if (rec.crypto_hex) {
  try {
    const c = rec.crypto_hex;
    console.log('\nFound crypto_hex blob. Trying decrypt attempts on crypto_hex:');
    console.log('crypto_hex iv', c.iv, 'ct', (c.ciphertext||'').slice(0,64)+'...', 'tag', c.mac);

    const ivC = hexToBuf(c.iv);
    const ctC = hexToBuf(c.ciphertext);
    const tagC = hexToBuf(c.mac);
    const ephemPubC = String(c.ephemPublicKey).replace(/^0x/, '').toLowerCase();

    // helper to attempt AES-GCM decrypt with given key, iv, ct and tag (either separate or appended)
    function tryAesGcmDecrypt(keyBuf, ivBuf, ctBuf, tagBuf) {
      try {
        const dec = crypto.createDecipheriv(keyBuf.length === 16 ? 'aes-128-gcm' : (keyBuf.length === 24 ? 'aes-192-gcm' : 'aes-256-gcm'), keyBuf, ivBuf, { authTagLength: tagBuf.length });
        dec.setAuthTag(tagBuf);
        const pt = Buffer.concat([dec.update(ctBuf), dec.final()]);
        return { ok: true, pt };
      } catch (e) {
        return { ok: false, err: e && e.message };
      }
    }

    // collect candidate kdfs: producer-derived and consumer-derived (if ephemPub matches)
    const candKdfs = [];
    if (kdfP) candKdfs.push({ name: 'producer-kdf', kdf: kdfP });
    try {
      const ephemBuf = hexToBuf(ephemPubC);
      const sharedC = secp.getSharedSecret(adminPrivBuf, ephemBuf);
      const last32c = Buffer.from(sharedC).slice(-32);
      const kdfC = crypto.createHash('sha256').update(last32c).digest();
      candKdfs.push({ name: 'consumer-kdf', kdf: kdfC });
      console.log('derived consumer kdf for crypto_hex:', kdfC.toString('hex'));
    } catch (e) {
      console.error('failed to derive consumer kdf for crypto_hex:', e && e.message);
    }

    // try a small set of AAD candidates
    const aads = [null, Buffer.alloc(0), hexToBuf(ephemPubC), Buffer.from(String(rec.address || ''), 'utf8')];

    for (const cand of candKdfs) {
      for (const ks of [16,24,32]) {
        const keyTry = cand.kdf.slice(0, ks);
        for (const aad of aads) {
          try {
            // attempt decrypt treating tag as separate
            if (aad && aad.length) {
              // set AAD if present
            }
            const dec = crypto.createDecipheriv(ks === 16 ? 'aes-128-gcm' : (ks === 24 ? 'aes-192-gcm' : 'aes-256-gcm'), keyTry, ivC, { authTagLength: tagC.length });
            if (aad && aad.length) dec.setAAD(aad);
            dec.setAuthTag(tagC);
            const pt = Buffer.concat([dec.update(ctC), dec.final()]);
            console.log(`crypto_hex decrypt SUCCESS cand=${cand.name} keylen=${ks*8} aad=${aad ? aad.toString('hex').slice(0,48) : '<none>'} -> plaintext(len=${pt.length})`);
            console.log('plaintext (hex start):', pt.toString('hex').slice(0,128));
            process.exit(0);
          } catch (e) {
            // try appended-tag interpretation: if ciphertext ends with tag, split
            try {
              if (ctC.length > 16) {
                const maybeTag = ctC.slice(ctC.length - 16);
                const maybeCt = ctC.slice(0, ctC.length - 16);
                const dec2 = crypto.createDecipheriv(ks === 16 ? 'aes-128-gcm' : (ks === 24 ? 'aes-192-gcm' : 'aes-256-gcm'), keyTry, ivC, { authTagLength: 16 });
                if (aad && aad.length) dec2.setAAD(aad);
                dec2.setAuthTag(maybeTag);
                const pt2 = Buffer.concat([dec2.update(maybeCt), dec2.final()]);
                console.log(`crypto_hex decrypt SUCCESS (appended-tag) cand=${cand.name} keylen=${ks*8} aad=${aad ? aad.toString('hex').slice(0,48) : '<none>'} -> plaintext(len=${pt2.length})`);
                console.log('plaintext (hex start):', pt2.toString('hex').slice(0,128));
                process.exit(0);
              }
            } catch (e2) {
              // continue
            }
          }
        }
      }
    }

    console.log('All crypto_hex decrypt attempts failed.');
  } catch (e) {
    console.error('crypto_hex block test failed:', e && e.message);
  }
}
