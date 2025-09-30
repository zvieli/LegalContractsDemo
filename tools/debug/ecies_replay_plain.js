import fs from 'fs';
import path from 'path';
import * as secp from '@noble/secp256k1';
import crypto from 'crypto';

function strip0x(s) { if (!s && s !== 0) return s; let t = String(s).trim(); if (t.startsWith('0x')) t = t.slice(2); return t; }
function hexToBuf(h) { if (!h) return Buffer.alloc(0); return Buffer.from(strip0x(h), 'hex'); }

const dbgDir = path.resolve(process.cwd(), 'evidence_storage');
const files = fs.readdirSync(dbgDir).filter(f => f.startsWith('producer_debug_') && f.endsWith('.json'))
  .map(f => ({ f, t: Number(f.split('_')[2].split('.json')[0]) || 0 }))
  .sort((a,b)=>b.t - a.t)
  .map(x=>x.f);

let chosen = null;
for (const f of files) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dbgDir, f), 'utf8'));
    if (doc && Array.isArray(doc.recipients) && doc.recipients.length>0) {
      for (const r of doc.recipients) {
        if (r && r.encryptedKey && r.encryptedKey._plaintextHex) { chosen = { f, doc, r }; break; }
      }
    }
    if (chosen) break;
  } catch (e) {}
}

if (!chosen) {
  console.error('No producer_debug with _plaintextHex found');
  process.exit(2);
}

console.log('Using producer_debug file:', chosen.f);
const producerDoc = chosen.doc;
const rec = chosen.r;
const enc = rec.encryptedKey;
console.log('enc iv', enc.iv, 'ct', (enc.ciphertext||'').slice(0,64)+'...', 'mac', enc.mac);

const ephPriv = enc._ephemeralPrivate || producerDoc._ephemeralPrivate || null;
const adminPriv = producerDoc.adminPriv || null;
const symHex = producerDoc.symKey || producerDoc.symKeyHex || null;
const plaintextHex = enc._plaintextHex || producerDoc._plaintextHex || null;

if (!ephPriv || !plaintextHex) {
  console.error('missing ephPriv or plaintextHex in chosen producer_debug');
  process.exit(2);
}

const ephPrivBuf = hexToBuf(ephPriv);
const ephemPubBuf = secp.getPublicKey(ephPrivBuf, false);
const ephemPubHex = Buffer.from(ephemPubBuf).toString('hex');
console.log('recomputed ephPub hex matches:', ephemPubHex === String(enc.ephemPublicKey).replace(/^0x/, '').toLowerCase());

// derive producer-side kdf using ephPriv + adminPub if adminPriv present
let kdfP = null;
try {
  if (adminPriv) {
    const adminPrivBuf = hexToBuf(adminPriv);
    const sharedP = secp.getSharedSecret(ephPrivBuf, secp.getPublicKey(adminPrivBuf, false));
    const last32p = Buffer.from(sharedP).slice(-32);
    kdfP = crypto.createHash('sha256').update(last32p).digest();
    console.log('derived kdf (producer-side) hex:', kdfP.toString('hex'));
  }
} catch (e) { console.error('producer kdf derive failed', e && e.message); }

// also derive consumer kdf by using adminPriv (if available) and ephemPub
let kdfC = null;
try {
  if (adminPriv) {
    const adminPrivBuf = hexToBuf(adminPriv);
    const ephemBuf = hexToBuf(enc.ephemPublicKey);
    const sharedC = secp.getSharedSecret(adminPrivBuf, ephemBuf);
    const last32c = Buffer.from(sharedC).slice(-32);
    kdfC = crypto.createHash('sha256').update(last32c).digest();
    console.log('derived kdf (consumer-side) hex:', kdfC.toString('hex'));
  }
} catch (e) { console.error('consumer kdf derive failed', e && e.message); }

// plaintext
const pt = Buffer.from(String(plaintextHex).replace(/^0x/, ''), 'hex');
const iv = hexToBuf(enc.iv);
const storedCt = hexToBuf(enc.ciphertext);
const storedTag = hexToBuf(enc.mac);

function tryEncryptWithKdf(kdf) {
  for (const ks of [32,24,16]) {
    const key = kdf.slice(0, ks);
    const alg = ks===16 ? 'aes-128-gcm' : (ks===24 ? 'aes-192-gcm' : 'aes-256-gcm');
    try {
      const cipher = crypto.createCipheriv(alg, key, iv, { authTagLength: storedTag.length });
      const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
      const tag = cipher.getAuthTag();
      console.log(`try kdf[0:${ks}] alg=${alg} produced ct=${ct.toString('hex')} tag=${tag.toString('hex')}`);
      console.log('stored ct=', storedCt.toString('hex'));
      console.log('stored tag=', storedTag.toString('hex'));
      console.log('ct match?', ct.toString('hex') === storedCt.toString('hex'));
      console.log('tag match?', tag.toString('hex') === storedTag.toString('hex'));
      if (ct.toString('hex') === storedCt.toString('hex') && tag.toString('hex') === storedTag.toString('hex')) return true;
    } catch (e) {
      console.error('encrypt attempt failed', e && e.message);
    }
  }
  return false;
}

let matched = false;
if (kdfP) matched = tryEncryptWithKdf(kdfP);
if (!matched && kdfC) matched = tryEncryptWithKdf(kdfC);

if (matched) console.log('\nMATCH: producer plaintext re-encrypt reproduced stored ciphertext+tag');
else console.log('\nNO MATCH: even using producer plaintext and derived KDFs the ciphertext/tag differ');

process.exit(matched?0:3);
