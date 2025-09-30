#!/usr/bin/env node
"use strict";
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');

// Helpers imported from the running endpoint to keep normalization rules consistent
let helpers = null;
try {
  helpers = require(path.resolve(__dirname, '..', 'evidence-endpoint.cjs'));
} catch (e) {
  console.warn('Could not load evidence-endpoint helpers, falling back to local normalization.', e && e.message);
}

const normalizePubForEthCrypto = (helpers && helpers.normalizePubForEthCrypto) ? helpers.normalizePubForEthCrypto : function(pub) {
  if (!pub) return null;
  let s = String(pub).trim();
  if (s.startsWith('0x')) s = s.slice(2);
  if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
  if (s.length === 130 && !s.startsWith('04')) s = '04' + s;
  return s.toLowerCase();
};

const canonicalizeAddress = (helpers && helpers.canonicalizeAddress) ? helpers.canonicalizeAddress : function(addr) {
  if (!addr) return null;
  let s = String(addr).trim();
  if (!s) return null;
  if (!s.startsWith('0x')) s = '0x' + s;
  return s.toLowerCase();
};

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.join(REPO_ROOT, 'evidence_storage');
const INDEX_FILE = path.join(STORAGE_DIR, 'index.json');

function backupStorage(backupDir) {
  // Prefer fs.cpSync if available (Node 16+), otherwise copy file-by-file
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (typeof fs.cpSync === 'function') {
      fs.cpSync(STORAGE_DIR, backupDir, { recursive: true });
    } else {
      const files = fs.readdirSync(STORAGE_DIR);
      for (const f of files) {
        const src = path.join(STORAGE_DIR, f);
        const dst = path.join(backupDir, f);
        fs.copyFileSync(src, dst);
      }
    }
    return true;
  } catch (e) {
    console.error('Backup failed', e && e.message ? e.message : e);
    return false;
  }
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function normalizeEncryptedKey(enc) {
  if (!enc) return null;
  let obj = enc;
  if (typeof enc === 'string') {
    const parsed = safeParseJson(enc);
    if (parsed) obj = parsed; else return enc; // leave opaque strings as-is
  }
  // Ensure canonical fields exist as strings or null
  const safe = {
    iv: obj.iv ? String(obj.iv) : null,
    ephemPublicKey: obj.ephemPublicKey ? String(obj.ephemPublicKey) : null,
    ciphertext: obj.ciphertext ? String(obj.ciphertext) : null,
    mac: obj.mac ? String(obj.mac) : null
  };
  return safe;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--yes') || args.includes('-y');

  if (!fs.existsSync(STORAGE_DIR)) {
    console.error('evidence_storage directory not found at', STORAGE_DIR);
    process.exit(1);
  }

  const backupDir = STORAGE_DIR + '_backup_' + Date.now();
  console.log('Creating backup at', backupDir);
  const backed = backupStorage(backupDir);
  if (!backed) {
    console.error('Backup failed — aborting migration');
    process.exit(2);
  }

  const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
  let changedCount = 0;
  const indexRaw = fs.existsSync(INDEX_FILE) ? fs.readFileSync(INDEX_FILE, 'utf8') : null;
  let indexJson = safeParseJson(indexRaw) || { entries: [] };

  for (const f of files) {
    try {
      const p = path.join(STORAGE_DIR, f);
      const raw = fs.readFileSync(p, 'utf8');
      const obj = safeParseJson(raw);
      if (!obj) {
        console.warn('Skipping non-JSON file', f);
        continue;
      }
      const envelope = obj; // expected shape
      let modified = false;
      if (Array.isArray(envelope.recipients)) {
        for (let i = 0; i < envelope.recipients.length; i++) {
          const r = envelope.recipients[i] || {};
          const orig = Object.assign({}, r);
          // normalize pubkey
          if (r.pubkey) {
            const norm = normalizePubForEthCrypto(r.pubkey);
            if (norm !== r.pubkey) { r.pubkey = norm; modified = true; }
          }
          // normalize address
          if (r.address) {
            const can = canonicalizeAddress(r.address);
            if (can !== r.address) { r.address = can; modified = true; }
          }
          // encryptedKey string -> object
          if (r.encryptedKey && typeof r.encryptedKey === 'string') {
            const parsed = safeParseJson(r.encryptedKey);
            if (parsed) {
              r.encryptedKey = normalizeEncryptedKey(parsed);
              modified = true;
            } else {
              // leave opaque string but log
              console.warn('Recipient encryptedKey is a non-JSON string in', f);
            }
          } else if (r.encryptedKey && typeof r.encryptedKey === 'object') {
            const safe = normalizeEncryptedKey(r.encryptedKey);
            // Check equality
            if (JSON.stringify(safe) !== JSON.stringify(r.encryptedKey)) {
              r.encryptedKey = safe; modified = true;
            }
          }
          envelope.recipients[i] = r;
        }
      }

      if (modified) {
        changedCount++;
        console.log((apply ? 'Updating' : 'Would update'), f);
      }
      // Always recompute fileHash and update index entry when applying
      if (apply) {
        try {
                // write back canonical envelope if modified
                if (modified) fs.writeFileSync(p, JSON.stringify(envelope, null, 2), 'utf8');
                // compute keccak256 in a way compatible with ethers v5 and v6
                let fileHash = null;
                const dataBuf = Buffer.from(JSON.stringify(envelope, null, 2), 'utf8');
                try {
                  if (ethers && ethers.utils && typeof ethers.utils.keccak256 === 'function') {
                    fileHash = ethers.utils.keccak256(dataBuf);
                  } else if (ethers && ethers.hashes && typeof ethers.hashes.keccak256 === 'function') {
                    fileHash = ethers.hashes.keccak256(dataBuf);
                  } else {
                    // fallback to require('ethers').utils
                    const e2 = require('ethers');
                    if (e2 && e2.utils && typeof e2.utils.keccak256 === 'function') fileHash = e2.utils.keccak256(dataBuf);
                    else if (e2 && e2.hashes && typeof e2.hashes.keccak256 === 'function') fileHash = e2.hashes.keccak256(dataBuf);
                  }
                } catch (e) {
                  console.warn('Keccak compute failed', e && e.message);
                  fileHash = null;
                }
          
          const digest = envelope.digest || null;
          if (digest) {
            const idx = indexJson.entries.findIndex(e => e.digest === digest);
            if (idx >= 0) {
              indexJson.entries[idx].recipients = (envelope.recipients || []).map(r => r.address);
              indexJson.entries[idx].fileHash = fileHash;
              console.log('Updated index.json for digest', digest);
            } else {
              // If not found, add a new index entry
              indexJson.entries.unshift({ digest: digest, recipients: (envelope.recipients || []).map(r => r.address), fileHash: fileHash, savedAt: envelope.timestamp || new Date().toISOString(), cid: null, uri: null, txHash: envelope.txHash || null, type: envelope.type || null, contractAddress: envelope.contractAddress || null });
              console.log('Added new index.json entry for digest', digest);
            }
          }
        } catch (e) {
          console.warn('Failed to update index entry for', f, e && e.message);
        }
      }
    } catch (e) {
      console.warn('Error processing', f, e && e.message ? e.message : e);
    }
  }

  if (apply) {
    try {
      fs.writeFileSync(INDEX_FILE, JSON.stringify(indexJson, null, 2), 'utf8');
      console.log('Wrote updated index.json');
    } catch (e) {
      console.warn('Failed writing index.json', e && e.message);
    }
  }

  console.log('Migration summary: files examined=', files.length, 'files changed=', changedCount, 'apply=', apply);
  if (!apply) console.log('Dry-run complete. To apply changes, re-run with --yes');
}

main().catch((e) => { console.error('Migration failed', e && e.stack ? e.stack : e); process.exit(1); });
