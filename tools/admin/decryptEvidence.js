#!/usr/bin/env node
// tools/admin/decryptEvidence.js — clean ESM CLI

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAdminPrivateKey() {
  if (process.env.ADMIN_PRIVATE_KEY) return process.env.ADMIN_PRIVATE_KEY.startsWith('0x') ? process.env.ADMIN_PRIVATE_KEY : '0x' + process.env.ADMIN_PRIVATE_KEY;
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    const p = path.resolve(__dirname, '..', '..', process.env.ADMIN_PRIVATE_KEY_FILE);
    if (fs.existsSync(p)) {
      let pk = fs.readFileSync(p, 'utf8').trim();
      if (!pk.startsWith('0x')) pk = '0x' + pk;
      return pk;
    }
  }
  const rootKey = path.resolve(__dirname, '..', '..', 'admin.key');
  if (fs.existsSync(rootKey)) {
    let pk = fs.readFileSync(rootKey, 'utf8').trim();
    if (!pk.startsWith('0x')) pk = '0x' + pk;
    return pk;
  }
  return null;
}

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
  if (args.length < 1) {
    console.error('Usage: node tools/admin/decryptEvidence.js <digest-or-filename> [--privkey 0x...]');
    process.exit(1);
  }
  const target = args[0];
  const pkIndex = args.indexOf('--privkey');
  const privKeyArg = pkIndex >= 0 && args.length > pkIndex + 1 ? args[pkIndex + 1] : null;

  const ADMIN_PRIV = privKeyArg || loadAdminPrivateKey();
  if (!ADMIN_PRIV) {
    console.error('No admin private key configured. Set ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY_FILE or pass --privkey');
    process.exit(2);
  }
  const pk = ADMIN_PRIV.startsWith('0x') ? ADMIN_PRIV.slice(2) : ADMIN_PRIV;

  // TESTING helper: when a privkey is passed via --privkey and TESTING=1, dump it to evidence_storage
  // so test runners can reproduce CLI decrypt attempts locally. This is only for debugging in TESTING.
  try {
    if (process && process.env && process.env.TESTING && privKeyArg) {
      const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
      try { if (!fs.existsSync(dbgDir)) fs.mkdirSync(dbgDir, { recursive: true }); } catch (e) {}
      try { fs.writeFileSync(path.join(dbgDir, 'last_cli_privkey.txt'), String(ADMIN_PRIV), { encoding: 'utf8' }); } catch (e) {}
    }
  } catch (e) {}

  let filePath = null;
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    filePath = path.resolve(target);
  } else {
    const d = target.replace(/^0x/, '');
    const storageDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
    if (!fs.existsSync(storageDir)) { console.error('evidence_storage not found'); process.exit(3); }
    const files = fs.readdirSync(storageDir).filter(f => f.includes(d));
    if (!files || files.length === 0) { console.error('No evidence file found for digest', target); process.exit(4); }
    filePath = path.join(storageDir, files[0]);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let envelope = null;
  try { envelope = JSON.parse(raw); } catch (e) { console.error('File is not JSON'); process.exit(5); }

  // TESTING: dump raw per-recipient byte-level hex for offline analysis
  try {
    if (process && process.env && process.env.TESTING) {
      const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
      try { if (!fs.existsSync(dbgDir)) fs.mkdirSync(dbgDir, { recursive: true }); } catch (e) {}

      const toHex = (s) => {
        if (!s) return null;
        const str = String(s).trim();
        // If explicitly 0x-prefixed, strip and lowercase
        if (str.startsWith('0x')) return str.slice(2).toLowerCase();
        // If pure hex, return as-is (lowercased)
        if (/^[0-9a-fA-F]+$/.test(str)) return str.toLowerCase();
        // Try base64 decode when it looks like base64
        try {
          if (/^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0) {
            return Buffer.from(str, 'base64').toString('hex');
          }
        } catch (e) {}
        // fallback: hex of utf8
        return Buffer.from(str, 'utf8').toString('hex');
      };

      const recipients_debug = (envelope.recipients || []).map((r) => {
        const enc = r.encryptedKey || r.encryptedKey_ecc || {};
        const cryptoObj = envelope.crypto || null;
        const rec = {
          address: r.address || null,
          pubkey: r.pubkey || null,
          encryptedKey_raw: enc,
          encryptedKey_hex: {
            iv: toHex(enc && enc.iv),
            ephemPublicKey: toHex(enc && (enc.ephemPublicKey || enc.ephemPublicKey)),
            ciphertext: toHex(enc && enc.ciphertext),
            mac: toHex(enc && enc.mac)
          }
        };
        if (cryptoObj) {
          rec.crypto_hex = {
            iv: toHex(cryptoObj.iv),
            ephemPublicKey: toHex(cryptoObj.ephemPublicKey),
            ciphertext: toHex(cryptoObj.ciphertext),
            mac: toHex(cryptoObj.mac)
          };
        }
        return rec;
      });

      try { fs.writeFileSync(path.join(dbgDir, 'last_cli_rawbytes.json'), JSON.stringify({ timestamp: new Date().toISOString(), file: filePath, recipients: recipients_debug }, null, 2), 'utf8'); } catch (e) {}
    }
  } catch (e) {}

  // TESTING: dump the exact envelope and privkey used by this CLI invocation for debugging
  try {
    if (process && process.env && process.env.TESTING) {
      const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
      try { if (!fs.existsSync(dbgDir)) fs.mkdirSync(dbgDir, { recursive: true }); } catch (e) {}
      try { fs.writeFileSync(path.join(dbgDir, 'last_cli_debug.json'), JSON.stringify({ file: filePath, envelope: envelope, adminPriv: ADMIN_PRIV }, null, 2), 'utf8'); } catch (e) {}
    }
  } catch (e) {}

  // Attempt to reuse the in-process decrypt helper (same codepath used by decrypt-cli).
  // This avoids subtle differences between the CLI and the helper implementation.
  try {
    const helper = await import('./decryptHelper.js').catch(() => null);
    if (helper && (helper.decryptEvidencePayload || helper.default)) {
      try {
        const decryptFn = helper.decryptEvidencePayload || (helper.default && helper.default.decryptEvidencePayload);
        if (decryptFn) {
          // Try helper with multiple key formats to tolerate consumers passing 0x or no-0x variants
          const tryKeys = [ADMIN_PRIV, (ADMIN_PRIV && ADMIN_PRIV.startsWith('0x')) ? ADMIN_PRIV.slice(2) : ADMIN_PRIV, (ADMIN_PRIV && !ADMIN_PRIV.startsWith('0x')) ? '0x' + ADMIN_PRIV : ADMIN_PRIV];
          let got = null;
          for (const k of tryKeys) {
            try {
              if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_HELPER_TRYKEY=' + String(k).slice(-12));
              const plain = await decryptFn(envelope, k);
              if (plain) { got = plain; break; }
            } catch (e) {
              if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_HELPER_TRYKEY_FAIL=' + (e && e.message ? e.message : e));
            }
          }
          if (got) {
            try { const parsed = JSON.parse(got); console.log('Decrypted JSON content:\n' + JSON.stringify(parsed, null, 2)); } catch (e) { console.log('Decrypted plaintext:\n' + got); }
            process.exit(0);
          }
        }
      } catch (e) {
        if (process && process.env && process.env.TESTING) {
          console.error('TESTING_DECRYPT_HELPER_FAIL=' + (e && e.message ? e.message : e));
          try {
            const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
            try { if (!fs.existsSync(dbgDir)) fs.mkdirSync(dbgDir, { recursive: true }); } catch (ee) {}
            const dump = {
              timestamp: new Date().toISOString(),
              adminPrivPreview: String(ADMIN_PRIV).slice(-32),
              file: filePath || null,
              envelopeDigest: envelope && envelope.digest ? envelope.digest : null,
              error: (e && e.stack) ? e.stack : String(e)
            };
            try { fs.writeFileSync(path.join(dbgDir, 'last_helper_error.txt'), JSON.stringify(dump, null, 2), 'utf8'); } catch (ee) {}
            // Also dump the full envelope and the admin privkey used by the CLI to reproduce exact conditions
            try { fs.writeFileSync(path.join(dbgDir, 'last_cli_envelope.json'), JSON.stringify({ envelope: envelope, adminPriv: ADMIN_PRIV }, null, 2), 'utf8'); } catch (ee) {}
          } catch (ee) {}
        }
        // fallthrough to legacy logic
      }
    }
  } catch (e) {
    // ignore helper import failures and continue with existing logic
  }

  let symKeyHex = null;
  try {
    // Prefer eth-crypto's high-level API for consistency with how we encrypt in the endpoint.
    const ethCryptoModule = await import('eth-crypto');
    const EthCrypto = ethCryptoModule && (ethCryptoModule.default || ethCryptoModule);
    const privNo0x = pk.startsWith('0x') ? pk.slice(2) : pk;

    // Backwards-compatibility: if endpoint provided envelope.crypto (eth-crypto-style
    // encryption of the plaintext content itself), try decrypting that first. This
    // prevents failures when the recipient-encrypted symmetric key can't be parsed
    // by older or mismatched ECIES consumers.
    try {
      if (envelope && envelope.crypto) {
        const maybeCrypto = envelope.crypto;
        try {
          const decPlain = await EthCrypto.decryptWithPrivateKey(privNo0x, maybeCrypto);
          if (decPlain) {
            // Successfully obtained plaintext content (string). Print and exit.
            try { const parsed = JSON.parse(decPlain); console.log('Decrypted JSON content:\n' + JSON.stringify(parsed, null, 2)); } catch (e) { console.log('Decrypted plaintext:\n' + decPlain); }
            process.exit(0);
          }
        } catch (e) {
          // try with 0x prefix variant
          try {
            const decPlain2 = await EthCrypto.decryptWithPrivateKey('0x' + privNo0x, maybeCrypto);
            if (decPlain2) {
              try { const parsed = JSON.parse(decPlain2); console.log('Decrypted JSON content:\n' + JSON.stringify(parsed, null, 2)); } catch (e) { console.log('Decrypted plaintext:\n' + decPlain2); }
              process.exit(0);
            }
          } catch (ee) {
            if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_CRYPTO_FAIL=' + (ee && ee.message ? ee.message : ee));
          }
          // Try eccrypto fallback on the envelope.crypto object (in case eth-crypto backend differences cause Bad MAC)
          try {
            const eccryptoModule = await import('eccrypto');
            const eccrypto = eccryptoModule && (eccryptoModule.default || eccryptoModule);
            let ob = maybeCrypto;
            if (typeof ob === 'string') {
              try { ob = JSON.parse(ob); } catch (e) { ob = null; }
            }
            if (ob && typeof ob === 'object') {
              const twoStripped = pk.replace(/^0x/, '');
              const encryptedBuffer = {
                iv: Buffer.from(String(ob.iv).replace(/^0x/, ''), 'hex'),
                ephemPublicKey: Buffer.from(String(ob.ephemPublicKey).replace(/^0x/, ''), 'hex'),
                ciphertext: Buffer.from(String(ob.ciphertext).replace(/^0x/, ''), 'hex'),
                mac: Buffer.from(String(ob.mac).replace(/^0x/, ''), 'hex')
              };
              try {
                const decBuf = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encryptedBuffer);
                if (decBuf && decBuf.length > 0) {
                  const decStr = decBuf.toString('utf8');
                  try { const parsed = JSON.parse(decStr); console.log('Decrypted JSON content:\n' + JSON.stringify(parsed, null, 2)); } catch (e) { console.log('Decrypted plaintext:\n' + decStr); }
                  process.exit(0);
                }
              } catch (ee) {
                if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_CRYPTO_ECC_FAIL=' + (ee && ee.message ? ee.message : ee));
              }
            }
          } catch (eee) {
            // ignore
          }
        }
      }
    } catch (e) {}

    async function tryDecryptWithEthCrypto(priv, enc) {
      // enc may be a hex string, a JSON string, or an object with fields
      if (!enc) return null;
      let local = enc;
      if (typeof local === 'string') {
        const maybe = String(local).trim();
        const isHex = /^0x?[0-9a-fA-F]+$/.test(maybe);
        if (isHex) {
          try {
            if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_EVIDENCE_ATTEMPT=stringHex len=' + maybe.replace(/^0x/, '').length);
            const dec = await EthCrypto.decryptWithPrivateKey(priv, maybe);
            return dec;
          } catch (e) {
            if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_EVIDENCE_STRINGHEX_FAIL=' + (e && e.message ? e.message : e));
            // fallthrough to try parsing as JSON
          }
        }
        try { local = JSON.parse(local); } catch (e) { local = null; }
      }
      if (!local || typeof local !== 'object') return null;

      // validate required fields
      const required = ['iv', 'ephemPublicKey', 'ciphertext', 'mac'];
      for (const f of required) if (!local[f]) return null;

      // normalize: strip 0x and lowercase
      const norm = {};
      for (const f of required) {
        let s = String(local[f]); if (s.startsWith('0x')) s = s.slice(2); s = s.trim(); norm[f] = s.toLowerCase();
      }
      if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_EVIDENCE_FIELDS len iv=' + norm.iv.length + ' ephem=' + norm.ephemPublicKey.length + ' ct=' + norm.ciphertext.length + ' mac=' + norm.mac.length);

      // Try multiple EthCrypto variants to tolerate minor formatting differences
      const attempts = [];
      attempts.push({ priv: priv, cipher: norm });
      attempts.push({ priv: '0x' + priv, cipher: norm });
      attempts.push({ priv: priv, cipher: local });
      const upper = Object.assign({}, norm); for (const k of required) upper[k] = String(upper[k]).toUpperCase(); attempts.push({ priv: priv, cipher: upper });

      for (const a of attempts) {
        try {
          if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_EVIDENCE_TRY=' + (a.priv && a.priv.slice ? a.priv.slice(-8) : '') + ':' + (a.cipher && a.cipher.ciphertext ? String(a.cipher.ciphertext).slice(0,8) : ''));
          const dec = await EthCrypto.decryptWithPrivateKey(a.priv, a.cipher);
          if (dec) return dec;
        } catch (e) {
          if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_EVIDENCE_ATTEMPT_FAIL=' + (e && e.message ? e.message : e));
        }
      }
      return null;
    }

    for (const r of envelope.recipients || []) {
      let enc = r.encryptedKey;
      if (!enc) continue;
      try {
        const dec = await tryDecryptWithEthCrypto(privNo0x, enc);
        if (dec) { symKeyHex = String(dec); break; }
        // If EthCrypto didn't work, try ECCrypto fallback
        try {
          const eccryptoModule = await import('eccrypto');
          const eccrypto = eccryptoModule && (eccryptoModule.default || eccryptoModule);
          // ensure enc is object with hex strings
          let ob = enc;
          if (typeof ob === 'string') {
            try { ob = JSON.parse(ob); } catch (e) { ob = null; }
          }
          if (!ob) continue;
          const twoStripped = pk.replace(/^0x/, '');
          const encryptedBuffer = {
            iv: Buffer.from(String(ob.iv).replace(/^0x/, ''), 'hex'),
            ephemPublicKey: Buffer.from(String(ob.ephemPublicKey).replace(/^0x/, ''), 'hex'),
            ciphertext: Buffer.from(String(ob.ciphertext).replace(/^0x/, ''), 'hex'),
            mac: Buffer.from(String(ob.mac).replace(/^0x/, ''), 'hex')
          };
          const decBuf = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encryptedBuffer);
          if (decBuf && decBuf.length > 0) { symKeyHex = decBuf.toString('utf8'); break; }
        } catch (ee) {
          console.error('eccrypto fallback failed for recipient; continuing. Err:', ee && ee.message ? ee.message : ee);
        }
      } catch (e) {
        if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_RECIPIENT_ERR=' + (e && e.message ? e.message : e));
      }
    }
  } catch (e) { console.error('Missing eth-crypto or decryption failed', e && e.message); process.exit(6); }

  if (!symKeyHex) {
    // Try a more exhaustive approach: collect candidate symmetric keys from all recipients
    const candidates = [];
    try {
      const ethCryptoModule = await import('eth-crypto');
      const EthCrypto = ethCryptoModule && (ethCryptoModule.default || ethCryptoModule);
      const privNo0x = pk.startsWith('0x') ? pk.slice(2) : pk;
      for (const r of envelope.recipients || []) {
        let enc = r.encryptedKey;
        if (!enc) continue;
        // try eth-crypto decrypt variants but collect failures as candidate raw text too
        try {
          if (typeof enc === 'string') {
            const maybe = String(enc).trim();
            try { const dec = await EthCrypto.decryptWithPrivateKey(privNo0x, maybe); if (dec) candidates.push(String(dec)); } catch (e) {}
            try { const parsed = JSON.parse(maybe); const dec = await EthCrypto.decryptWithPrivateKey(privNo0x, parsed); if (dec) candidates.push(String(dec)); } catch (e) {}
          } else {
            try { const dec = await EthCrypto.decryptWithPrivateKey(privNo0x, enc); if (dec) candidates.push(String(dec)); } catch (e) {}
          }
        } catch (e) {}
        // Try eccrypto fallback and add its buffer as candidate strings
        try {
          const eccryptoModule = await import('eccrypto');
          const eccrypto = eccryptoModule && (eccryptoModule.default || eccryptoModule);
          let ob = enc;
          if (typeof ob === 'string') {
            try { ob = JSON.parse(ob); } catch (e) { ob = null; }
          }
          if (ob) {
            const twoStripped = pk.replace(/^0x/, '');
            const encryptedBuffer = {
              iv: Buffer.from(String(ob.iv).replace(/^0x/, ''), 'hex'),
              ephemPublicKey: Buffer.from(String(ob.ephemPublicKey).replace(/^0x/, ''), 'hex'),
              ciphertext: Buffer.from(String(ob.ciphertext).replace(/^0x/, ''), 'hex'),
              mac: Buffer.from(String(ob.mac).replace(/^0x/, ''), 'hex')
            };
            try {
              const decBuf = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encryptedBuffer);
              if (decBuf) {
                candidates.push(decBuf.toString('utf8'));
                candidates.push(decBuf.toString('hex'));
                candidates.push(decBuf.toString('base64'));
              }
            } catch (ee) {}
          }
        } catch (ee) {}
      }
    } catch (e) {}

    // Deduplicate candidates and try AES-GCM decrypt using each candidate as hex or raw
    const tried = new Set();
    for (const cand of candidates) {
      if (!cand) continue;
      if (tried.has(cand)) continue;
      tried.add(cand);
      const tries = [];
      // if looks like hex, try hex decode
      if (/^[0-9a-fA-F]+$/.test(cand)) tries.push(Buffer.from(cand, 'hex'));
      // if looks like base64
      if (/^[A-Za-z0-9+/=]+$/.test(cand)) {
        try { tries.push(Buffer.from(cand, 'base64')); } catch (e) {}
      }
      // raw utf8 bytes
      tries.push(Buffer.from(String(cand), 'utf8'));

      for (const symBufTry of tries) {
        if (!symBufTry || symBufTry.length !== 32) continue;
        try {
          const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBufTry);
          // If we can parse as JSON, success
          try { const parsed = JSON.parse(plaintext); console.log('Decrypted JSON content:\n' + JSON.stringify(parsed, null, 2)); process.exit(0); } catch (e) { console.log('Decrypted plaintext:\n' + plaintext); process.exit(0); }
        } catch (e) {
          // continue
        }
      }
    }

    console.error('Failed to decrypt symmetric key');
    process.exit(7);
  }

  const symBuf = Buffer.from(symKeyHex, 'hex');
  const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
  try { const parsed = JSON.parse(plaintext); console.log('Decrypted JSON content:\n' + JSON.stringify(parsed, null, 2)); } catch (e) { console.log('Decrypted plaintext:\n' + plaintext); }
}

main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(99); });
