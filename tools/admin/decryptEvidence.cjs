#!/usr/bin/env node
// tools/admin/decryptEvidence.cjs
// Usage: node tools/admin/decryptEvidence.cjs <digest-or-filename>
// If ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY_FILE is configured, it will be used. Otherwise pass private key via --privkey <0x...>

const fs = require('fs');
const path = require('path');
const EthCrypto = require('eth-crypto');
const crypto = require('crypto');
const { utils } = require('ethers');

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
  // repo-root admin.key fallback
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
    console.error('Usage: node tools/admin/decryptEvidence.cjs <digest-or-filename> [--privkey 0x...]');
    process.exit(1);
  }
  let target = args[0];
  let privKeyArg = null;
  const pkIndex = args.indexOf('--privkey');
  if (pkIndex >= 0 && args.length > pkIndex + 1) privKeyArg = args[pkIndex + 1];

  const ADMIN_PRIV = privKeyArg || loadAdminPrivateKey();
  if (!ADMIN_PRIV) {
    console.error('No admin private key configured. Set ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY_FILE or pass --privkey');
    process.exit(2);
  }
  const pk = ADMIN_PRIV.startsWith('0x') ? ADMIN_PRIV.slice(2) : ADMIN_PRIV;

  // Resolve file: if input is a filename that exists, use it; otherwise look for evidence_storage/*-<digest>.json
  let filePath = null;
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    filePath = path.resolve(target);
  } else {
    const d = target.replace(/^0x/, '');
    const storageDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
    if (!fs.existsSync(storageDir)) { console.error('evidence_storage not found'); process.exit(3); }
    const files = fs.readdirSync(storageDir).filter(f => f.endsWith(`-${d}.json`) || f.endsWith(`-${d}.bin`));
    if (!files || files.length === 0) { console.error('No evidence file found for digest', target); process.exit(4); }
    filePath = path.join(storageDir, files[0]);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let envelope = null;
  try { envelope = JSON.parse(raw); } catch (e) { console.error('File is not JSON'); process.exit(5); }

  // Find recipient entry for admin by comparing pubkeys
  // Compute admin public key from private key
  let adminPub = null;
  try { adminPub = EthCrypto.publicKeyByPrivateKey(pk); if (adminPub && adminPub.startsWith('0x')) adminPub = adminPub.slice(2); } catch (e) { console.error('Failed to derive admin public key:', e); process.exit(6); }
  // Also derive admin address from private key for robust matching
  let adminAddrFromPriv = null;
  try {
    const ethers = require('ethers');
    try {
      // Derive address directly from private key using Wallet (works across ethers versions)
      const w = new ethers.Wallet('0x' + pk);
      adminAddrFromPriv = w.address.toLowerCase();
    } catch (e) {
      adminAddrFromPriv = null;
    }
  } catch (e) { adminAddrFromPriv = null; }

  // Search recipients. Prefer matching by address (derived from private key), fallback to pubkey string compare.
  if (process.env.TESTING) console.error('TEST_DEBUG: derived adminPub=', adminPub);
  if (process.env.TESTING) console.error('TEST_DEBUG: derived adminAddrFromPriv=', adminAddrFromPriv);
  if (process.env.TESTING) console.error('TEST_DEBUG: envelope recipients=', JSON.stringify(envelope.recipients || [], null, 2));
  const rec = (envelope.recipients || []).find(r => {
    try {
      if (r.address && adminAddrFromPriv && r.address.toLowerCase() === adminAddrFromPriv) return true;
      if (r.pubkey) {
        try {
          const ethers = require('ethers');
          const pub = String(r.pubkey).replace(/^0x/, '');
          // computeAddress accepts uncompressed public key with 0x04 prefix
          const pubHex = pub.length === 128 ? '0x04' + pub : (pub.startsWith('04') ? '0x' + pub : '0x' + pub);
          const addr = (ethers.utils && ethers.utils.computeAddress) ? ethers.utils.computeAddress(pubHex).toLowerCase() : null;
          if (addr && adminAddrFromPriv && addr === adminAddrFromPriv) return true;
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {}
    return false;
  });
  if (!rec) {
    console.warn('No explicit recipient entry for admin found in envelope. Will attempt decrypt against all recipients. Recipients:', (envelope.recipients || []).map(r => r.address));
    // continue — we will try to decrypt against all recipients below
  }

  // Decrypt encryptedKey using EthCrypto. Try all recipients (robust in case addresses/pubkeys differ)
  let symKeyHex = null;
  let successRec = null;
  const recs = envelope.recipients || [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    let enc = r.encryptedKey;
    if (!enc) {
      if (process.env.TESTING) console.error('TEST_DEBUG: recipient', i, 'has no encryptedKey');
      continue;
    }
    if (typeof enc === 'string') {
      try { enc = JSON.parse(enc); } catch (e) { /* leave as string for EthCrypto to parse */ }
    }
    try {
      // Use eccrypto directly to get Buffer result (avoids string encoding pitfalls)
      const eccrypto = require('eccrypto');
      const twoStripped = pk.replace(/^0x/, '');
      const encryptedBuffer = {
        iv: Buffer.from(String(enc.iv), 'hex'),
        ephemPublicKey: Buffer.from(String(enc.ephemPublicKey), 'hex'),
        ciphertext: Buffer.from(String(enc.ciphertext), 'hex'),
        mac: Buffer.from(String(enc.mac), 'hex')
      };
      const decBuf = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encryptedBuffer);
      if (decBuf && decBuf.length > 0) {
        // decBuf contains the original message bytes (we encrypted the hex string), so interpret as utf8
        symKeyHex = decBuf.toString('utf8');
        successRec = { index: i, address: r.address, pubkey: r.pubkey };
        if (process.env.TESTING) console.error('TEST_DEBUG: successful decrypt with recipient index', i, 'address', r.address);
        break;
      }
    } catch (e) {
      if (process.env.TESTING) console.error('TEST_DEBUG: recipient', i, 'decrypt failed:', e && e.message ? e.message : e);
      // continue
    }
  }
  if (!symKeyHex) {
    console.error('Failed to decrypt symmetric key with provided private key for any recipient');
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
