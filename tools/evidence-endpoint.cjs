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
// We will use Helia (embedded IPFS) only for publishing evidence. Do not use ipfs-http-client.
let useHelia = true;
let heliaRuntime = null; // will hold the running helia node and unixfs instance
let uint8arrays = null;
let _heliaModulesLoaded = false;
async function loadHeliaModules() {
  if (_heliaModulesLoaded) return;
  try {
    // dynamic import to support ESM-only packages
    const heliaPkg = await import('helia');
    const unixfsPkg = await import('@helia/unixfs');
    uint8arrays = await import('uint8arrays');
    _heliaModulesLoaded = true;
    return { heliaPkg, unixfsPkg, uint8arrays };
  } catch (e) {
    console.error('Helia dynamic import failed. Ensure helia, @helia/unixfs and uint8arrays are installed:', e && e.message ? e.message : e);
    throw e;
  }
}

// Load .env from repository root (if present) so the endpoint can pick up ADMIN_* variables
try {
  // project root is one level above tools/
  const projectRootEnv = path.join(__dirname, '..', '.env');
  // Only load .env automatically when no ADMIN_* env vars are already set and the .env file exists.
  const shouldLoadDotenv = fs.existsSync(projectRootEnv) && !process.env.ADMIN_PUBLIC_KEY && !process.env.ADMIN_PUBLIC_KEY_FILE && !process.env.ADMIN_PRIVATE_KEY && !process.env.ADMIN_PRIVATE_KEY_FILE;
  if (shouldLoadDotenv) {
    require('dotenv').config({ path: projectRootEnv });
  }
} catch (e) {
  // ignore if dotenv not available
}

function parsePort(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Default port resolution order: CLI arg > EVIDENCE_PORT env > PORT env > 3000
const cliPort = process.argv[2] ? parsePort(process.argv[2]) : null;
const envPort = parsePort(process.env.EVIDENCE_PORT || process.env.PORT || 0);
const defaultPort = cliPort || envPort || 5001;
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
  // Fallback: if there is an admin.key file at the repo root, use it.
  try {
    const repoRootKey = path.resolve(path.join(__dirname, '..', 'admin.key'));
    if (fs.existsSync(repoRootKey)) {
      let pk = fs.readFileSync(repoRootKey, 'utf8').trim();
      if (!pk) return null;
      if (!pk.startsWith('0x')) pk = '0x' + pk;
      return pk;
    }
  } catch (e) {}
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

  // TESTING: early middleware to log incoming requests quickly for Playwright traces
  if (process.env.TESTING) {
    localApp.use((req, res, next) => {
      try {
        const method = req.method;
        const url = req.originalUrl || req.url || '/';
        const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
        console.error('TESTING_EARLY_RECV=' + method + ' ' + url + ' ip=' + ip);
      } catch (e) {}
      try { next(); } catch (e) { next(e); }
    });
  }

  localApp.post('/submit-evidence', async (req, res) => {
    try {
      const payload = req.body;
      // TESTING-only: log that we received the request (method, url, headers.content-type, body length)
      try {
        if (process.env.TESTING) {
          const method = req.method;
          const url = req.originalUrl || req.url || '/submit-evidence';
          const ct = req.headers && (req.headers['content-type'] || req.headers['Content-Type']) ? (req.headers['content-type'] || req.headers['Content-Type']) : 'unknown';
          let bodyLen = 0;
          try { bodyLen = req.rawBody ? req.rawBody.length : (req.body ? JSON.stringify(req.body).length : 0); } catch (e) { bodyLen = 0; }
          const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
          console.error('TESTING_RECEIVED=' + method + ' ' + url + ' content-type=' + ct + ' bodyLen=' + bodyLen + ' ip=' + ip);
          try {
            // print a small preview of headers and body for debugging
            const hdrs = Object.assign({}, req.headers);
            const previewBody = (() => { try { return req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : ''; } catch (e) { return ''; } })();
            console.error('TESTING_HEADERS=' + JSON.stringify(hdrs));
            console.error('TESTING_BODY_PREVIEW=' + (previewBody ? previewBody.slice(0, 1000) : '<empty>'));
          } catch (e) {}
        }
      } catch (e) {}
      // attach a finish listener to log response status when the handler completes
      try { if (process.env.TESTING) res.on('finish', () => console.error('TESTING_RESPONSE_SENT status=' + res.statusCode + ' url=' + (req.originalUrl || req.url))); } catch (e) {}
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
  // EthCrypto.encryptWithPublicKey accepts the public key as a hex string (uncompressed, with 04 prefix)
  // Passing the hex string avoids platform/browser-specific Buffer/Uint8Array subtle differences that
  // can lead to MAC failures when decrypting with the browser polyfill (eccrypto). Keep key with 0x prefix.
  // Build a normalized uncompressed public key and always pass it as 0x-prefixed
  let pubNorm = pubWith0x.replace(/^0x/, '');
  if (pubNorm.length === 128 && !pubNorm.startsWith('04')) pubNorm = '04' + pubNorm;
  if (pubNorm.length === 130 && !pubNorm.startsWith('04')) pubNorm = '04' + pubNorm; // defensive
  // eth-crypto expects a hex string (no 0x) for its public-key helpers
  const pubForEncrypt = pubNorm;
  let encrypted;
  let usedPubForm = 'normalized-0x04';
  try {
  encrypted = await EthCrypto.encryptWithPublicKey(pubForEncrypt, plaintext);
  } catch (e) {
    console.error('Encryption failed with normalized public key:', e && e.message ? e.message : e);
    throw e;
  }
        ciphertextJson = { version: '1', crypto: encrypted };
        // TESTING: which pub form was used
        try { if (process.env && process.env.TESTING) console.error('TESTING_ENCRYPT_PUB_FORM=' + usedPubForm); } catch (e) {}
        // TESTING: log shapes of the generated cipher components to help trace Bad MAC issues
        try {
          if (process.env && process.env.TESTING) {
            const c = encrypted || {};
            const diag = {
              ephemPublicKeyPrefix: c.ephemPublicKey ? String(c.ephemPublicKey).slice(0,8) : null,
              ephemPublicKeyLen: c.ephemPublicKey ? String(c.ephemPublicKey).length : null,
              ivLen: c.iv ? String(c.iv).length : null,
              ciphertextLen: c.ciphertext ? String(c.ciphertext).length : null,
              macLen: c.mac ? String(c.mac).length : null
            };
            console.error('TESTING_ENCRYPT_DIAG=' + JSON.stringify(diag));
          }
        } catch (e) {}
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

      // Normalize the crypto hex fields to deterministic forms before canonicalizing:
      try {
        if (ciphertextJson && ciphertextJson.crypto && typeof ciphertextJson.crypto === 'object') {
          const c = ciphertextJson.crypto;
          ['ephemPublicKey','iv','ciphertext','mac'].forEach(k => {
            if (c[k] && typeof c[k] === 'string') {
              let s = String(c[k]).trim();
              if (s.startsWith('0x')) s = s.slice(2);
              s = s.toLowerCase();
              // ensure ephemPublicKey has uncompressed 04 prefix when it's the 128-char x||y form
              if (k === 'ephemPublicKey') {
                // If the key is in x||y (128 hex chars) form, add the uncompressed '04' prefix.
                if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
                // If length is odd (malformed), prefix a '0' to make it even-length hex string.
                if (s.length % 2 === 1) s = '0' + s;
              }
              c[k] = s;
            }
          });
          // TESTING: log normalized cipher shapes
          try { if (process.env && process.env.TESTING) {
            const diag = {
              ephemPublicKeyPrefix: ciphertextJson.crypto.ephemPublicKey ? String(ciphertextJson.crypto.ephemPublicKey).slice(0,8) : null,
              ephemPublicKeyLen: ciphertextJson.crypto.ephemPublicKey ? String(ciphertextJson.crypto.ephemPublicKey).length : null,
              ivLen: ciphertextJson.crypto.iv ? String(ciphertextJson.crypto.iv).length : null,
              ciphertextLen: ciphertextJson.crypto.ciphertext ? String(ciphertextJson.crypto.ciphertext).length : null,
              macLen: ciphertextJson.crypto.mac ? String(ciphertextJson.crypto.mac).length : null
            };
            console.error('TESTING_CANONICAL_CIPHER_NORMALIZED=' + JSON.stringify(diag));
          } } catch (e) {}
        }
      } catch (e) {}

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
  try { if (process.env && process.env.TESTING) console.error('TESTING_CANONICAL=' + canonical.slice(0,1000)); } catch (e) {}

        // Publish canonical JSON using embedded Helia (no fallback allowed)
        let ipfsCid = null;
        let ipfsUri = null;
        try {
          if (!useHelia || !heliaRuntime) throw new Error('Helia not initialized');
          const data = uint8arrays.fromString(canonical, 'utf8');
          // try unixfs addBytes if available
          if (heliaRuntime.ufs && typeof heliaRuntime.ufs.addBytes === 'function') {
            const cid = await heliaRuntime.ufs.addBytes(data);
            ipfsCid = cid && cid.toString ? cid.toString() : String(cid);
          } else if (heliaRuntime.ufs && typeof heliaRuntime.ufs.add === 'function') {
            const out = await heliaRuntime.ufs.add(data);
            if (out) ipfsCid = (out.cid && out.cid.toString) ? out.cid.toString() : String(out);
          } else if (heliaRuntime.ufs && typeof heliaRuntime.ufs.addAll === 'function') {
            for await (const item of heliaRuntime.ufs.addAll([{ content: data }])) {
              if (item) ipfsCid = (item.cid && item.cid.toString) ? item.cid.toString() : String(item);
            }
          } else if (heliaRuntime.node && heliaRuntime.node.block && typeof heliaRuntime.node.block.put === 'function') {
            const p = await heliaRuntime.node.block.put(data);
            if (p && p.cid) ipfsCid = p.cid.toString();
          } else {
            throw new Error('no known Helia unixfs API available');
          }
          if (!ipfsCid) throw new Error('failed to obtain CID from Helia');
          ipfsUri = 'ipfs://' + ipfsCid;
          if (process.env.TESTING) console.error('TESTING_IPFS_ADDED=' + ipfsCid + '->' + filePath + ' (helia)');
        } catch (ipfsErr) {
          console.error('Helia publish failed:', ipfsErr && ipfsErr.message ? ipfsErr.message : ipfsErr);
          return res.status(500).json({ error: 'helia_publish_failed', message: ipfsErr && ipfsErr.message ? ipfsErr.message : String(ipfsErr) });
        }

      // TESTING-only logging: print which public key was used and which file/digest were written
      try {
        if (process.env.TESTING) {
          console.error('TESTING_ADMIN_PUB=' + ADMIN_PUB);
          console.error('TESTING_WRITTEN=' + digest + '->' + filePath);
        }
      } catch (e) {}

  // Include IPFS CID/URI when available so clients can pass the URI on-chain
  const resp = { digest, path: `/static/${fileName}`, file: filePath };
  if (ipfsCid) resp.ipfsCid = ipfsCid;
  if (ipfsUri) resp.ipfsUri = ipfsUri;
  return res.json(resp);
    } catch (err) {
      try { if (process.env && process.env.TESTING) console.error('TESTING_SUBMIT_ERROR=' + (err && err.stack ? err.stack : String(err))); } catch (e) {}
      console.error('submit-evidence error', err && err.stack ? err.stack : err);
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  });

  // Lightweight ping endpoint useful for Playwright to confirm connectivity from the browser
  localApp.get('/ping', (req, res) => {
    try {
      return res.json({ ok: true, ts: Date.now() });
    } catch (e) {
      return res.status(500).json({ ok: false });
    }
  });

  localApp.get('/health', (req, res) => res.json({ ok: true, staticDir: staticDirLocal }));

  const server = await new Promise((resolve, reject) => {
    const s = localApp.listen(port, '127.0.0.1', function() {
      resolve(s);
    });
    s.on('error', reject);
  });

  // Initialize Helia modules and runtime now (Helia is required)
  if (useHelia && !heliaRuntime) {
    try {
      const { heliaPkg, unixfsPkg } = await loadHeliaModules();
      const node = await heliaPkg.createHelia();
      // Create UnixFS using the helia node instance (this is the correct form)
      let ufs = null;
      try {
        ufs = unixfsPkg.unixfs(node);
      } catch (e) {
        console.warn('unixfs(node) failed, attempting fallback:', e && e.message ? e.message : e);
        try { ufs = unixfsPkg.unixfs({ dag: node.dag }); } catch (e2) { ufs = null; }
      }
      heliaRuntime = { node, ufs, heliaPkg, unixfsPkg };
      console.log('Helia in-process IPFS node started for evidence publishing.');
    } catch (e) {
      console.error('Failed to start Helia node at startup:', e && e.message ? e.message : e);
      try { server.close(); } catch (ee) {}
      throw e;
    }
  }

  let actualPort = port;
  try {
    const addr = server.address();
    if (addr && addr.port) actualPort = addr.port;
  } catch (e) {}
  console.log(`Evidence endpoint listening on http://127.0.0.1:${actualPort} (static dir: ${staticDirLocal})`);
  try {
    if (process.env && process.env.TESTING) {
      let hasSecp = false;
      try { require('secp256k1'); hasSecp = true; } catch (e) {}
      console.error('TESTING_ENDPOINT_ENV node=' + (process && process.versions && process.versions.node) + ' secp256k1=' + String(hasSecp));
    }
  } catch (e) {}
  return server;
}

// Graceful shutdown for Helia
function _maybeShutdownHelia() {
  if (heliaRuntime && heliaRuntime.node) {
    try {
      if (typeof heliaRuntime.node.stop === 'function') {
        heliaRuntime.node.stop().catch((e) => {});
      } else if (typeof heliaRuntime.node.close === 'function') {
        heliaRuntime.node.close().catch((e) => {});
      }
    } catch (e) {}
  }
}
process.on('exit', _maybeShutdownHelia);
process.on('SIGINT', () => { _maybeShutdownHelia(); process.exit(0); });

// If script executed directly, start server with CLI args
if (require.main === module) {
  startEvidenceEndpoint(defaultPort, defaultStaticDir).catch((e) => {
    console.error('Failed to start evidence endpoint:', e && e.message ? e.message : e);
    process.exit(1);
  });

}

module.exports = { startEvidenceEndpoint };
