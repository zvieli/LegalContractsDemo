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
  // Priority: ADMIN_PUBLIC_KEY, ADMIN_PRIVATE_KEY_FILE -> derive, ADMIN_PRIVATE_KEY -> derive, fallback generate dev keypair
  if (process.env.ADMIN_PUBLIC_KEY) {
    let pk = process.env.ADMIN_PUBLIC_KEY.trim();
    if (pk.startsWith('0x')) pk = pk.slice(2);
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
  return pub && pub.startsWith('0x') ? pub.slice(2) : pub;
    } catch (e) {
      console.warn('Could not read ADMIN_PRIVATE_KEY_FILE:', e.message);
    }
  }
  if (process.env.ADMIN_PRIVATE_KEY) {
    try {
  let pk = process.env.ADMIN_PRIVATE_KEY.trim();
  if (pk.startsWith('0x')) pk = pk.slice(2);
      const pub2 = EthCrypto.publicKeyByPrivateKey(pk);
      try { console.log('DEBUG: derived pub from ADMIN_PRIVATE_KEY:', pub2); } catch (e) {}
      return pub2 && pub2.startsWith('0x') ? pub2.slice(2) : pub2;
    } catch (e) {
      console.warn('Could not use ADMIN_PRIVATE_KEY:', e.message);
    }
  }
  // Dev fallback: generate keypair and print private key (not for production)
  const identity = EthCrypto.createIdentity();
  console.warn('No ADMIN key provided, generated dev keypair. Do NOT use in production. Admin private key:', identity.privateKey);
  return identity.publicKey && identity.publicKey.startsWith('0x') ? identity.publicKey.slice(2) : identity.publicKey;
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

      // If client supplied an already-encrypted wrapper { version: '1', crypto: { ... } }, accept it and
      // write it verbatim (after schema validation). Otherwise, encrypt the provided plaintext with ADMIN_PUB.
      let ciphertextJson;
      const isWrapper = payload && typeof payload === 'object' && payload.version && payload.crypto && typeof payload.crypto === 'object';
      if (isWrapper) {
        ciphertextJson = payload;
      } else {
        const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const encrypted = await EthCrypto.encryptWithPublicKey(ADMIN_PUB, plaintext);
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
