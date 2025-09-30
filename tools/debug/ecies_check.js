import fs from 'fs';
import path from 'path';
import * as ecies from '../crypto/ecies.js';
import * as secp from '@noble/secp256k1';
import crypto from 'crypto';

const dbgDir = path.resolve(process.cwd(), 'evidence_storage');
const last = JSON.parse(fs.readFileSync(path.join(dbgDir, 'last_cli_debug.json'), 'utf8'));
const rawbytes = JSON.parse(fs.readFileSync(path.join(dbgDir, 'last_cli_rawbytes.json'), 'utf8'));

console.log('Loaded last_cli_debug.json file:', last.file);
const env = last.envelope;
const adminPriv = last.adminPriv.startsWith('0x') ? last.adminPriv.slice(2) : last.adminPriv;
console.log('adminPriv (hex):', adminPriv);
const rec = rawbytes.recipients[0];
console.log('Recipient address:', rec.address);
const enc = rec.encryptedKey_raw || rec.encryptedKey_hex || rec.encryptedKey_raw;
console.log('EncryptedKey raw:', enc);

// Try canonical ecies.decryptWithPrivateKey
(async () => {
  try {
    const dec = await ecies.decryptWithPrivateKey(adminPriv, enc);
    console.log('\necies.decryptWithPrivateKey SUCCESS, plaintext length:', dec && dec.length);
    console.log('plaintext:', dec);
  } catch (e) {
    console.error('\necies.decryptWithPrivateKey FAILED:', e && e.message);
  }

  // manual steps
  try {
    // Try to recover symmetric key from both sides and compare producer in-memory vs on-disk
    const adminPrivBuf = Buffer.from(String(adminPriv).replace(/^0x/, ''), 'hex');

    // Compute shared and KDF from consumer (adminPriv + ephemPub)
    const ephemHex = String(enc.ephemPublicKey || enc.ephemPublicKey || '').replace(/^0x/, '');
    const ephemBuf = Buffer.from(ephemHex, 'hex');
    const shared = secp.getSharedSecret(adminPrivBuf, ephemBuf);
    const last32 = Buffer.from(shared).slice(-32);
    const kdf = crypto.createHash('sha256').update(last32).digest();
    console.log('consumer shared last32 (hex):', last32.toString('hex'));
    console.log('consumer kdf sha256(last32) (hex):', kdf.toString('hex'));

    // Manual AES-GCM decrypt attempt using multiple KDF candidates (consumer side)
    const ivHex = rec.encryptedKey_hex.iv;
    const ctHex = rec.encryptedKey_hex.ciphertext;
    const tagHex = rec.encryptedKey_hex.mac;
    console.log('iv', ivHex, 'ct len', ctHex && ctHex.length, 'tag', tagHex);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');

    // helper to try AES-GCM decrypt with a given key buffer
    const tryAes = (keyBuf, ivBuf = iv, ctBuf = ct, tagBuf = tag) => {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf, { authTagLength: 16 });
        decipher.setAuthTag(tagBuf);
        const out = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
        return { ok: true, out };
      } catch (e) {
        return { ok: false, err: e };
      }
    };

  // build KDF/key candidates
  const fullShared = Buffer.from(shared);
  const first32 = fullShared.slice(0, 32);
  const last32buf = fullShared.slice(-32);
  // Broaden candidate set to include common variants seen across libraries/implementations
  const adminPub = secp.getPublicKey(adminPrivBuf, false);
  const ephemBufFull = ephemBuf;
  const ephemX = ephemBufFull && ephemBufFull.length >= 33 ? ephemBufFull.slice(1, 33) : null;
  const sha = (b) => crypto.createHash('sha256').update(b).digest();
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
    // helper to compute keccak256 using ethers (available in repo)
    const keccakBuf = async (b) => {
      try {
        const em = await import('ethers').then(m => m.utils || m);
        const k = em.keccak256(Buffer.from(b));
        return Buffer.from(String(k).replace(/^0x/, ''), 'hex');
      } catch (e) {
        return null;
      }
    };

    // simple HKDF-SHA256 extract/expand
    const hkdfSha256 = (ikm, salt = Buffer.alloc(32, 0), info = Buffer.alloc(0), size = 32) => {
      const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
      let prev = Buffer.alloc(0);
      const out = [];
      const n = Math.ceil(size / 32);
      for (let i = 0; i < n; i++) {
        const h = crypto.createHmac('sha256', prk);
        h.update(Buffer.concat([prev, info, Buffer.from([i + 1])]));
        prev = h.digest();
        out.push(prev);
      }
      return Buffer.concat(out).slice(0, size);
    };
    const candidates = [
      { name: 'sha256(last32)', key: sha(last32buf) },
      { name: 'sha256(fullShared)', key: sha(fullShared) },
      { name: 'raw(last32)', key: last32buf },
      { name: 'sha256(first32)', key: sha(first32) },
      { name: 'raw(first32)', key: first32 },
      { name: 'sha256(shared.slice(1))', key: sha(Buffer.from(shared).slice(1)) },
      { name: 'sha256(ephemPub)', key: sha(ephemBufFull) },
      { name: 'sha256(ephemPubX)', key: ephemX ? sha(ephemX) : null },
      { name: 'sha256(adminPub)', key: sha(adminPub) },
      { name: 'raw(fullShared)', key: fullShared },
      // reversed/byte-order variants
      { name: 'sha256(reverse(fullShared))', key: sha(Buffer.from(fullShared).reverse()) },
      { name: 'raw(reverse(fullShared))', key: Buffer.from(fullShared).reverse() },
      // concat-derived variants
      { name: 'sha256(last32||ephemX)', key: (ephemX ? sha(Buffer.concat([last32buf, ephemX])) : null) },
      { name: 'sha256(ephemX||last32)', key: (ephemX ? sha(Buffer.concat([ephemX, last32buf])) : null) },
      { name: 'sha256(fullShared||ephemPub)', key: sha(Buffer.concat([fullShared, ephemBufFull])) },
      { name: 'sha256(ephemPub||fullShared)', key: sha(Buffer.concat([ephemBufFull, fullShared])) },
      // HMAC-based KDFs (common in some custom wrappers)
      { name: 'hmac-sha256(ephemPub as key)', key: hmac(ephemBufFull, fullShared) },
      { name: 'hmac-sha256(adminPub as key)', key: hmac(adminPub, fullShared) },
      { name: 'hmac-sha256(last32 as key)', key: hmac(last32buf, fullShared) },
      // raw ephem x coordinate
      { name: 'raw(ephemX)', key: ephemX },
    ].filter(c => c && c.key);

    // Append keccak and HKDF variants asynchronously
    const extraCandidates = [];
    const keccakLast32 = await keccakBuf(last32buf);
  if (keccakLast32) extraCandidates.push({ name: 'keccak256(last32)', key: keccakLast32 });
  const keccakFull = await keccakBuf(fullShared);
  if (keccakFull) extraCandidates.push({ name: 'keccak256(fullShared)', key: keccakFull });
  const keccakEphemX = ephemX ? await keccakBuf(ephemX) : null;
  if (keccakEphemX) extraCandidates.push({ name: 'keccak256(ephemPubX)', key: keccakEphemX });
  // keccak concatenation variants
  const keccakConcat = await keccakBuf(Buffer.concat([fullShared, ephemBufFull]));
  if (keccakConcat) extraCandidates.push({ name: 'keccak256(fullShared||ephemPub)', key: keccakConcat });
    // HKDF using ephemPub as salt or adminPub as salt
    try {
      extraCandidates.push({ name: 'hkdf(ephemPub)', key: hkdfSha256(fullShared, ephemBufFull) });
      extraCandidates.push({ name: 'hkdf(adminPub)', key: hkdfSha256(fullShared, adminPub) });
    } catch (e) {}
    // push extras
    for (const e of extraCandidates) candidates.push(e);

    let recoveredCandidate = null;
    for (const c of candidates) {
      try {
        // First try normal separate-tag decrypt
        let res = tryAes(c.key);
        // If failed, try the variant where tag is appended to ciphertext (common in some libs)
        if (!res.ok && ct.length > 16) {
          const tagFromCt = ct.slice(ct.length - 16);
          const ctNoTag = ct.slice(0, ct.length - 16);
          res = tryAes(c.key, iv, ctNoTag, tagFromCt);
        }

        if (res.ok) {
          console.log(`\nManual AES-GCM decrypt SUCCESS with candidate: ${c.name}`);
          console.log('key (hex):', c.key.toString('hex'));
          const plainHex = res.out.toString('hex');
          const plainUtf8 = (() => { try { return res.out.toString('utf8'); } catch (e) { return '<invalid utf8>'; } })();
          console.log('plaintext hex:', plainHex);
          console.log('plaintext utf8:', plainUtf8);
          // If plaintext looks like hex string, also try to interpret it as hex -> bytes
          if (/^[0-9a-fA-F]+$/.test(plainUtf8) && plainUtf8.length % 2 === 0) {
            try {
              const asBytes = Buffer.from(plainUtf8.replace(/^0x/, ''), 'hex');
              console.log('plaintext interpreted as hex -> bytes (hex):', asBytes.toString('hex'));
              console.log('plaintext interpreted as hex -> utf8:', (() => { try { return asBytes.toString('utf8'); } catch (e) { return '<invalid utf8>'; } })());
            } catch (e) {}
          }
          // If plaintext base64-ish, try base64 decode
          if (/^[A-Za-z0-9+/=\s]+$/.test(plainUtf8) && plainUtf8.length % 4 === 0) {
            try {
              const b64 = Buffer.from(plainUtf8, 'base64');
              console.log('plaintext interpreted as base64 -> hex:', b64.toString('hex'));
              console.log('plaintext interpreted as base64 -> utf8:', (() => { try { return b64.toString('utf8'); } catch (e) { return '<invalid utf8>'; } })());
            } catch (e) {}
          }
          recoveredCandidate = { name: c.name, key: c.key, out: res.out };
          break;
        } else {
          console.log(`Manual AES-GCM decrypt failed for candidate ${c.name}:`, res.err && res.err.message);
        }
      } catch (e) {
        console.log(`candidate ${c.name} threw:`, e && e.message);
      }
    }

    if (!recoveredCandidate) console.log('\nNo candidate succeeded to decrypt recipient.encryptedKey on consumer side.');

    // Attempt to locate producer ephemeral private and decrypt as producer would
    const maybeEphFromEnc = enc._ephemeralPrivate || enc.ephemPrivate || null;
    let ephPrivHex = maybeEphFromEnc;
    if (!ephPrivHex) {
      // try to find a producer debug file that contains matching ephemPublicKey
      const files = fs.readdirSync(dbgDir).filter(f => f.startsWith('producer_debug_') && f.endsWith('.json'));
      for (const f of files) {
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(dbgDir, f), 'utf8'));
          if (!doc || !Array.isArray(doc.recipients)) continue;
          for (const r of doc.recipients) {
            const rEphem = (r.encryptedKey && (r.encryptedKey.ephemPublicKey || r.encryptedKey.ephemPublicKey)) || r.ephemPublicKey || r.ephem_pub;
            if (!rEphem) continue;
            if (String(rEphem).replace(/^0x/, '').toLowerCase() === ephemHex.toLowerCase()) {
              ephPrivHex = (r.encryptedKey && r.encryptedKey._ephemeralPrivate) || r._ephemeralPrivate || null;
              if (ephPrivHex) break;
            }
          }
          if (ephPrivHex) break;
        } catch (e) { /* ignore parse errors */ }
      }
    }

    console.log('\n_discovered ephemeral private (hex):', ephPrivHex);
    if (ephPrivHex) {
      const ephPrivBuf = Buffer.from(String(ephPrivHex).replace(/^0x/, ''), 'hex');
      // derive admin public from adminPriv
      const adminPub = secp.getPublicKey(adminPrivBuf, false);
      const sharedP = secp.getSharedSecret(ephPrivBuf, adminPub);
      const last32p = Buffer.from(sharedP).slice(-32);
      const kdfP = crypto.createHash('sha256').update(last32p).digest();
      console.log('producer shared last32 (hex):', last32p.toString('hex'));
      console.log('producer kdf sha256(last32) (hex):', kdfP.toString('hex'));

      // decrypt using producer-derived key
      // Try producer-path decrypt, with appended-tag fallback
      try {
        let ok = false;
        try {
          const decipher2 = crypto.createDecipheriv('aes-256-gcm', kdfP, iv, { authTagLength: 16 });
          decipher2.setAuthTag(tag);
          const out2 = Buffer.concat([decipher2.update(ct), decipher2.final()]);
          console.log('\nManual AES-GCM decrypt (producer key) SUCCESS, plaintext hex:', out2.toString('hex'));
          console.log('plaintext utf8:', out2.toString('utf8'));
          ok = true;
        } catch (err1) {
          if (ct.length > 16) {
            try {
              const tagFromCt = ct.slice(ct.length - 16);
              const ctNoTag = ct.slice(0, ct.length - 16);
              const decipher3 = crypto.createDecipheriv('aes-256-gcm', kdfP, iv, { authTagLength: 16 });
              decipher3.setAuthTag(tagFromCt);
              const out3 = Buffer.concat([decipher3.update(ctNoTag), decipher3.final()]);
              console.log('\nManual AES-GCM decrypt (producer key, appended-tag) SUCCESS, plaintext hex:', out3.toString('hex'));
              console.log('plaintext utf8:', out3.toString('utf8'));
              ok = true;
            } catch (err2) {
              console.error('\nManual AES-GCM decrypt (producer key) FAILED (both variants):', err2 && err2.message);
            }
          } else {
            console.error('\nManual AES-GCM decrypt (producer key) FAILED:', err1 && err1.message);
          }
        }
        if (!ok) {
          // continue, we will attempt other methods below
        }
      } catch (ee) {
        console.error('\nManual AES-GCM decrypt (producer key) FAILED:', ee && ee.message);
      }

      // Compare producer in-memory encryptedKey fields vs on-disk envelope (rec.encryptedKey_hex)
      // Find producer record again to extract the producer-reported fields
      let prodRec = null;
      const files2 = fs.readdirSync(dbgDir).filter(f => f.startsWith('producer_debug_') && f.endsWith('.json'));
      for (const f of files2) {
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(dbgDir, f), 'utf8'));
          if (!doc || !Array.isArray(doc.recipients)) continue;
          for (const r of doc.recipients) {
            const rEphem = (r.encryptedKey && r.encryptedKey.ephemPublicKey) || r.ephemPublicKey || null;
            if (!rEphem) continue;
            if (String(rEphem).replace(/^0x/, '').toLowerCase() === ephemHex.toLowerCase()) { prodRec = r; break; }
          }
        } catch (e) {}
        if (prodRec) break;
      }

      if (prodRec && prodRec.encryptedKey) {
        const p = prodRec.encryptedKey;
        const normalize = s => String(s || '').replace(/^0x/, '').toLowerCase();
        const a_iv = normalize(p.iv || p.iv_hex || p.ivHex || '');
        const a_ct = normalize(p.ciphertext || p.ciphertext_hex || p.ct || '');
        const a_tag = normalize(p.mac || p.tag || p.authTag || '');
        const b_iv = normalize(rec.encryptedKey_hex.iv);
        const b_ct = normalize(rec.encryptedKey_hex.ciphertext);
        const b_tag = normalize(rec.encryptedKey_hex.mac);

        console.log('\nComparing producer in-memory encryptedKey vs envelope on-disk:');
        console.log('iv match?', a_iv === b_iv, 'producer iv len', a_iv.length, 'disk iv len', b_iv.length);
        console.log('ciphertext match?', a_ct === b_ct, 'producer ct len', a_ct.length, 'disk ct len', b_ct.length);
        console.log('mac/tag match?', a_tag === b_tag, 'producer tag len', a_tag.length, 'disk tag len', b_tag.length);
        if (a_iv !== b_iv) console.log('producer iv:', a_iv, '\ndisk iv:    ', b_iv);
        if (a_ct !== b_ct) console.log('producer ct (start):', a_ct.slice(0,64), '\ndisk ct (start):    ', b_ct.slice(0,64));
        if (a_tag !== b_tag) console.log('producer tag:', a_tag, '\ndisk tag:   ', b_tag);
      } else {
        console.log('Could not find matching producer_debug record to compare encryptedKey fields.');
      }
    } else {
      console.log('No ephemeral private available from enc or producer debug files; cannot run producer-path decrypt.');
    }
    
    // Now attempt to decrypt the wrapped key (recipient.encryptedKey) to recover the symmetric key bytes
    try {
      // The encryptedKey ciphertext is an AES-GCM encrypt of the symKeyHex string (per endpoint implementation)
      // We will attempt to use the consumer-derived KDF key to decrypt encryptedKey.ciphertext and recover symKeyHex
      const encKeyObj = { iv: rec.encryptedKey_hex.iv, ephemPublicKey: rec.encryptedKey_hex.ephemPublicKey, ciphertext: rec.encryptedKey_hex.ciphertext, mac: rec.encryptedKey_hex.mac };
      // Use ecies.decryptWithPrivateKey with adminPriv to see if it recovers symKey as utf8 hex string
      try {
        const recovered = await ecies.decryptWithPrivateKey(adminPriv, encKeyObj);
        console.log('\nRecovered symKey (consumer decryptWithPrivateKey) as utf8 string:', recovered);
      } catch (e) {
        console.error('\nconsumer decryptWithPrivateKey failed to recover symKey:', e && e.message);
      }

      // Try producer-path decrypt: use ephPriv to derive key and AES-GCM decrypt the encryptedKey ciphertext directly to bytes
      if (ephPrivHex) {
        const ephPrivBuf = Buffer.from(String(ephPrivHex).replace(/^0x/, ''), 'hex');
        const adminPub = secp.getPublicKey(adminPrivBuf, false);
        const sharedP = secp.getSharedSecret(ephPrivBuf, adminPub);
        const last32p = Buffer.from(sharedP).slice(-32);
        const kdfP = crypto.createHash('sha256').update(last32p).digest();
        // decrypt the encryptedKey ciphertext which should give us symKey bytes (encoded as hex string by producer)
        try {
          const iv2 = Buffer.from(String(encKeyObj.iv).replace(/^0x/, ''), 'hex');
          const tag2 = Buffer.from(String(encKeyObj.mac).replace(/^0x/, ''), 'hex');
          const ct2 = Buffer.from(String(encKeyObj.ciphertext).replace(/^0x/, ''), 'hex');
          const dec2 = crypto.createDecipheriv('aes-256-gcm', kdfP, iv2, { authTagLength: 16 });
          dec2.setAuthTag(tag2);
          const out2 = Buffer.concat([dec2.update(ct2), dec2.final()]);
          const recoveredSymHex = out2.toString('utf8');
          console.log('\nRecovered symKey (producer decrypt using ephPriv) as utf8 hex:', recoveredSymHex);

          // If producer debug included symKey, compare them
          if (prodRec && prodRec.parentSymKey) {
            console.log('producer debug symKey:', prodRec.parentSymKey);
          }

          // Compare with producer_debug symKey if available
          try {
            const prodFiles = fs.readdirSync(dbgDir).filter(f => f.startsWith('producer_debug_') && f.endsWith('.json'));
            for (const f of prodFiles) {
              try {
                const doc = JSON.parse(fs.readFileSync(path.join(dbgDir, f), 'utf8'));
                if (doc && doc.symKey) {
                  console.log('producer_debug file', f, 'symKey:', doc.symKey);
                  console.log('matches recovered?', doc.symKey.replace(/^0x/, '').toLowerCase() === recoveredSymHex.replace(/^0x/, '').toLowerCase());
                  break;
                }
              } catch (e) {}
            }
          } catch (e) {}

          // Now attempt to decrypt the top-level envelope ciphertext with recovered symKey
          try {
            // top-level ciphertext is base64 in envelope.ciphertext
            const topo = last.envelope && last.envelope.ciphertext;
            if (topo) {
              const topCt = Buffer.from(String(topo), 'base64');
              // top-level aes iv/tag are base64 in envelope.encryption.aes
              const topIv = Buffer.from(String(last.envelope.encryption.aes.iv), 'base64');
              const topTag = Buffer.from(String(last.envelope.encryption.aes.tag), 'base64');
              const symBuf = Buffer.from(String(recoveredSymHex).replace(/^0x/, ''), 'hex');
              const decTop = crypto.createDecipheriv('aes-256-gcm', symBuf, topIv, { authTagLength: 16 });
              decTop.setAuthTag(topTag);
              const topPlain = Buffer.concat([decTop.update(topCt), decTop.final()]);
              console.log('\nTop-level AES-GCM decrypt SUCCESS with recovered symKey; plaintext utf8:', topPlain.toString('utf8'));
            } else {
              console.log('No top-level ciphertext found in envelope to test.');
            }
          } catch (e) {
            console.error('\nTop-level AES-GCM decrypt FAILED with recovered symKey:', e && e.message);
          }

        } catch (e) {
          console.error('\nProducer-path decrypt of encryptedKey FAILED:', e && e.message);
        }
      }
    } catch (e) {
      console.error('Wrapped-key decrypt checks failed', e && e.message);
    }
  } catch (e) {
    console.error('Manual check failed', e && e.message);
  }
})();
