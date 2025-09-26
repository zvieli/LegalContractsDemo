"use strict";
// Simple evidence endpoint: POST /submit-evidence
// - Encrypts payload with admin public key (env: ADMIN_PUBLIC_KEY or derived from ADMIN_PRIVATE_KEY_FILE/ADMIN_PRIVATE_KEY)
// - Canonicalizes ciphertext JSON, computes keccak256 of UTF-8 bytes and writes file <digest>.json under the static dir
// - Returns { digest, path }

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const EthCrypto = require('eth-crypto');
const { keccak256, toUtf8Bytes } = require('ethers').utils || require('ethers');

// Load .env from repository root (if present) so the endpoint can pick up ADMIN_* variables
try {
  // project root is one level above tools/
  const projectRootEnv = path.join(__dirname, '..', '.env');
  require('dotenv').config({ path: projectRootEnv });
} catch (e) {
  // ignore if dotenv not available
}

const defaultPort = process.argv[2] ? Number(process.argv[2]) : 3000;
const defaultStaticDir = process.argv[3] ? process.argv[3] : path.join(__dirname, '..', 'front', 'e2e', 'static');

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadAdminPublicKey() {
  // Priority: ADMIN_PUBLIC_KEY_FILE, ADMIN_PUBLIC_KEY, ADMIN_PRIVATE_KEY_FILE -> derive, ADMIN_PRIVATE_KEY -> derive
  // NOTE: do NOT generate a dev keypair automatically. If no admin key is configured, return null
  // and the endpoint will refuse to accept/store evidence. This prevents accidental storage
  // of raw plaintext or use of ephemeral keys.
  // If ADMIN_PUBLIC_KEY_FILE is set, prefer reading the public key from the file
  if (process.env.ADMIN_PUBLIC_KEY_FILE) {
    try {
      let pubPath = process.env.ADMIN_PUBLIC_KEY_FILE;
      if (!path.isAbsolute(pubPath)) pubPath = path.resolve(path.join(__dirname, '..', pubPath));
      let pub = fs.readFileSync(pubPath, 'utf8').trim();
      if (pub.startsWith('0x')) pub = pub.slice(2);
      // normalize: if key is 128 hex chars (x and y concatenated) add uncompressed 04 prefix
      if (pub.length === 128 && !pub.startsWith('04')) pub = '04' + pub;
      return pub;
    } catch (e) {
      console.warn('Could not read ADMIN_PUBLIC_KEY_FILE:', e.message);
    }
  }
  if (process.env.ADMIN_PUBLIC_KEY) {
    let pk = process.env.ADMIN_PUBLIC_KEY.trim();
    if (pk.startsWith('0x')) pk = pk.slice(2);
    if (pk.length === 128 && !pk.startsWith('04')) pk = '04' + pk;
    return pk;
  }
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    try {
      // Resolve relative paths against the repository root (one level above tools/)
      let keyPath = process.env.ADMIN_PRIVATE_KEY_FILE;
      if (!path.isAbsolute(keyPath)) keyPath = path.resolve(path.join(__dirname, '..', keyPath));
      let pk = fs.readFileSync(keyPath, 'utf8').trim();
      if (pk.startsWith('0x')) pk = pk.slice(2);
      const pub = EthCrypto.publicKeyByPrivateKey(pk);
      // EthCrypto returns 0x04... (uncompressed). Normalize to no-0x and ensure 04 prefix is present.
      let p = pub && pub.startsWith('0x') ? pub.slice(2) : pub;
      if (p && p.length === 128 && !p.startsWith('04')) p = '04' + p;
      return p;
    } catch (e) {
      console.warn('Could not read ADMIN_PRIVATE_KEY_FILE:', e.message);
    }
  }
  if (process.env.ADMIN_PRIVATE_KEY) {
    try {
      let pk = process.env.ADMIN_PRIVATE_KEY.trim();
      if (pk.startsWith('0x')) pk = pk.slice(2);
      const pub2 = EthCrypto.publicKeyByPrivateKey(pk);
      let p2 = pub2 && pub2.startsWith('0x') ? pub2.slice(2) : pub2;
      if (p2 && p2.length === 128 && !p2.startsWith('04')) p2 = '04' + p2;
      return p2;
    } catch (e) {
      console.warn('Could not use ADMIN_PRIVATE_KEY:', e.message);
    }
  }
  // If we get here, there is no admin key configured. Return null and refuse uploads.
  console.warn('No ADMIN_PUBLIC_KEY / ADMIN_PRIVATE_KEY configured; endpoint will refuse uploads until an admin key is provided.');
  return null;
}

function loadAdminPrivateKey() {
  // Prefer ADMIN_PRIVATE_KEY_FILE, then ADMIN_PRIVATE_KEY. Return with 0x prefix if present, else null.
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    try {
      let keyPath = process.env.ADMIN_PRIVATE_KEY_FILE;
      if (!path.isAbsolute(keyPath)) keyPath = path.resolve(path.join(__dirname, '..', keyPath));
      let pk = fs.readFileSync(keyPath, 'utf8').trim();
      if (!pk) return null;
      if (!pk.startsWith('0x')) pk = '0x' + pk;
      return pk;
    } catch (e) {
      console.warn('Could not read ADMIN_PRIVATE_KEY_FILE:', e.message);
    }
  }
  if (process.env.ADMIN_PRIVATE_KEY) {
    try {
      let pk = process.env.ADMIN_PRIVATE_KEY.trim();
      if (!pk) return null;
      if (!pk.startsWith('0x')) pk = '0x' + pk;
      return pk;
    } catch (e) {
      console.warn('Could not read ADMIN_PRIVATE_KEY from env:', e.message);
    }
  }
  return null;
}

// Routes are created inside startEvidenceEndpoint to allow in-process startup for tests

async function startEvidenceEndpoint(portArg = defaultPort, staticDirArg = defaultStaticDir, adminPubArg) {
  // Allow explicit 0 to request an ephemeral port; coerce strings and fall back to default
  let port = typeof portArg === 'number' ? portArg : Number(portArg);
  if (!Number.isFinite(port)) {
    port = typeof defaultPort === 'number' ? defaultPort : Number(defaultPort) || 0;
  }
  const staticDirLocal = staticDirArg || defaultStaticDir;
  ensureDir(staticDirLocal);

  const ADMIN_PUB = adminPubArg ? (adminPubArg.startsWith('0x') ? adminPubArg.slice(2) : adminPubArg) : loadAdminPublicKey();
  const ADMIN_PRIV = loadAdminPrivateKey();

  // Log admin public key (safe) and whether a private key was loaded (don't log private key!)
  try {
    if (ADMIN_PUB) {
      const pubOut = ADMIN_PUB.startsWith('0x') ? ADMIN_PUB : '0x' + ADMIN_PUB;
      // Short, safe display: show first 10 and last 8 chars
      const short = pubOut.slice(0, 10) + '...' + pubOut.slice(-8);
      console.log('ADMIN_PUBLIC_KEY=' + short);
      // Also write a repo-root admin.pub file containing the full 0x-prefixed public key (safe to store)
      try {
        const adminPubPath = path.resolve(path.join(__dirname, '..', 'admin.pub'));
        if (!fs.existsSync(adminPubPath)) {
          fs.writeFileSync(adminPubPath, pubOut, { encoding: 'utf8', flag: 'w' });
          console.log('Wrote admin.pub to', adminPubPath);
          // helpful marker for e2e and manual checks
          console.log('admin.pub written');
        }
      } catch (e) {
        console.warn('Failed to write admin.pub:', e && e.message ? e.message : e);
      }
    } else {
      console.warn('ADMIN_PUBLIC_KEY not configured; endpoint will refuse uploads.');
    }
    console.log('ADMIN_PRIVATE_KEY available on server: ' + (ADMIN_PRIV ? 'yes (using file or env)' : 'no'));
  } catch (e) {}

  // wire up app routes (use same app instance defined above)
  // Note: we re-create a new Express app here to avoid cross-test state
  const localApp = express();
  localApp.use(cors());
  localApp.use(bodyParser.json({ limit: '2mb' }));

  localApp.post('/submit-evidence', async (req, res) => {
    try {
      const payload = req.body;
      if (!payload) return res.status(400).json({ error: 'missing payload' });

      const canon = (obj) => {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        if (Array.isArray(obj)) return '[' + obj.map(canon).join(',') + ']';
        return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
      };

      // Require an admin public key to be configured. We will not accept raw plaintext nor accept
      // uploads when ADMIN_PUB is not set. This prevents accidental storage under ephemeral keys.
      if (!ADMIN_PUB) {
        return res.status(400).json({ error: 'ADMIN_PUBLIC_KEY not configured on the server. Configure ADMIN_PUBLIC_KEY or ADMIN_PRIVATE_KEY_FILE to accept evidence uploads.' });
      }

      // If client supplied an already-encrypted wrapper { version: '1', crypto: { ... } }, validate it
      // when the server holds the admin private key. Otherwise encrypt the provided plaintext with ADMIN_PUB.
      let ciphertextJson;
      const isWrapper = payload && typeof payload === 'object' && payload.version && payload.crypto && typeof payload.crypto === 'object';
      if (isWrapper) {
        // If server has admin private key, attempt to decrypt to ensure the wrapper targets our admin key.
        if (ADMIN_PRIV) {
          try {
            await EthCrypto.decryptWithPrivateKey(ADMIN_PRIV, payload.crypto);
            // decryption succeeded -> wrapper is valid for this admin key
            ciphertextJson = payload;
          } catch (e) {
            console.error('Wrapper decryption failed with server admin private key; rejecting upload.');
            // Provide admin public key in response so client can re-encrypt to the correct admin key
            const adminPubFull = ADMIN_PUB && ADMIN_PUB.startsWith('0x') ? ADMIN_PUB : (ADMIN_PUB ? '0x' + ADMIN_PUB : null);
            return res.status(400).json({ error: 'ciphertext wrapper not encrypted for this admin key', adminPublicKey: adminPubFull });
          }
        } else {
          // If the server does NOT have the private key, do NOT silently accept an arbitrary wrapper.
          // Instead, reject the upload and return the admin public key so the client can re-encrypt.
          console.error('Server does not have admin private key; rejecting ciphertext wrapper uploads.');
          const adminPubFull = ADMIN_PUB && ADMIN_PUB.startsWith('0x') ? ADMIN_PUB : (ADMIN_PUB ? '0x' + ADMIN_PUB : null);
          return res.status(400).json({ error: 'server_missing_admin_private_key', adminPublicKey: adminPubFull });
        }
      } else {
  const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const pubWith0x = ADMIN_PUB.startsWith('0x') ? ADMIN_PUB : '0x' + ADMIN_PUB;
  // EthCrypto.encryptWithPublicKey expects a Uint8Array/Buffer for the public key
  const pubBytes = Buffer.from(pubWith0x.replace(/^0x/, ''), 'hex');
  const encrypted = await EthCrypto.encryptWithPublicKey(pubBytes, plaintext);
        ciphertextJson = { version: '1', crypto: encrypted };
      }

      try {
        const Ajv = require('ajv');
        const ajv = new Ajv();
        const schema = {
          type: 'object',
          properties: {
            version: { type: 'string' },
            crypto: {
              type: 'object',
              properties: {
                ephemPublicKey: { type: 'string' },
                iv: { type: 'string' },
                ciphertext: { type: 'string' },
                mac: { type: 'string' }
              },
              required: ['ephemPublicKey','iv','ciphertext','mac']
            }
          },
          required: ['version','crypto']
        };
        const valid = ajv.validate(schema, ciphertextJson);
        if (!valid) {
          console.error('Ciphertext schema validation failed:', ajv.errors);
          return res.status(500).json({ error: 'ciphertext schema validation failed' });
        }
      } catch (e) {
        console.warn('Schema validation skipped (ajv error):', e && e.message ? e.message : e);
      }

      const canonical = canon(ciphertextJson);
      let digest;
      try {
        digest = require('ethers').keccak256 ? require('ethers').keccak256(require('ethers').toUtf8Bytes(canonical)) : keccak256(toUtf8Bytes(canonical));
      } catch (e) {
        const ethers = require('ethers');
        digest = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(canonical));
      }

      const fileName = digest.replace(/^0x/, '') + '.json';
      const filePath = path.join(staticDirLocal, fileName);
      fs.writeFileSync(filePath, canonical, 'utf8');

      // TESTING-only logging: print which public key was used and which file/digest were written
      try {
        if (process.env.TESTING) {
          console.error('TESTING_ADMIN_PUB=' + ADMIN_PUB);
          console.error('TESTING_WRITTEN=' + digest + '->' + filePath);
        }
      } catch (e) {}

      return res.json({ digest, path: `/static/${fileName}`, file: filePath });
    } catch (err) {
      console.error('submit-evidence error', err);
      return res.status(500).json({ error: err.message });
    }
  });

  localApp.get('/health', (req, res) => res.json({ ok: true, staticDir: staticDirLocal }));

  const server = await new Promise((resolve, reject) => {
    const s = localApp.listen(port, '127.0.0.1', function() {
      resolve(s);
    });
    s.on('error', reject);
  });

  let actualPort = port;
  try {
    const addr = server.address();
    if (addr && addr.port) actualPort = addr.port;
  } catch (e) {}
  console.log(`Evidence endpoint listening on http://127.0.0.1:${actualPort} (static dir: ${staticDirLocal})`);
  return server;
}

// If script executed directly, start server with CLI args
if (require.main === module) {
  startEvidenceEndpoint(defaultPort, defaultStaticDir).catch((e) => {
    console.error('Failed to start evidence endpoint:', e && e.message ? e.message : e);
    process.exit(1);
  });

}

module.exports = { startEvidenceEndpoint };
