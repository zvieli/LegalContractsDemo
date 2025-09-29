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

// Initialize Helia runtime once and return runtime object. Keeps heliaRuntime populated for reuse.
async function initHeliaIfNeeded() {
  if (!useHelia) return null;
  if (heliaRuntime) return heliaRuntime;
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
    return heliaRuntime;
  } catch (e) {
    console.error('Failed to start Helia node at startup:', e && e.message ? e.message : e);
    throw e;
  }
}

// Attach helia runtime to an express app so routes can access it via req.app.locals.heliaRuntime
function attachHeliaToApp(app) {
  try {
    if (app && heliaRuntime) app.locals.heliaRuntime = heliaRuntime;
  } catch (e) {}
}

// Normalize EthCrypto/EVM public key hex forms into Buffer (uncompressed 65-byte or compressed 33-byte)
function normalizePublicKeyToBuffer(pub) {
  if (!pub) throw new Error('no public key to normalize');
  let s = String(pub);
  if (s.startsWith('0x')) s = s.slice(2);
  s = s.trim();
  // If the key is 128 hex chars (x||y) add uncompressed 04 prefix
  if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
  // Defensive: if it's 130 but missing 04, add it
  if (s.length === 130 && !s.startsWith('04')) s = '04' + s;
  if (s.length % 2 === 1) s = '0' + s; // ensure even length
  const buf = Buffer.from(s, 'hex');
  // If library expects 65 bytes uncompressed, ensure it's 65
  if (buf.length === 65 || buf.length === 33) return buf;
  // If it's 64 (raw x+y without prefix), try adding 0x04
  if (buf.length === 64) return Buffer.concat([Buffer.from([0x04]), buf]);
  // Otherwise return as-is and let encrypt call decide/fail
  return buf;
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
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Default port resolution order: CLI arg > EVIDENCE_PORT env > PORT env > 3000
const cliPort = (typeof process.argv[2] !== 'undefined') ? parsePort(process.argv[2]) : null;
const envPort = parsePort(process.env.EVIDENCE_PORT || process.env.PORT);
const defaultPort = (cliPort !== null ? cliPort : (envPort !== null ? envPort : 5001));
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

  // Use a single exported Express app instance so other modules can reuse it.
  // Exported app is created once and routes are attached to it.
  if (!global.__evidence_exported_app) global.__evidence_exported_app = express();
  const exportedApp = global.__evidence_exported_app;
  // attach CORS and JSON body parsing (increase payload limit for file uploads)
  exportedApp.use(cors());
  exportedApp.use(bodyParser.json({ limit: '20mb' }));

  // TESTING: early middleware to log incoming requests quickly for Playwright traces
  if (process.env.TESTING) {
    exportedApp.use((req, res, next) => {
      try {
        const method = req.method;
        const url = req.originalUrl || req.url || '/';
        const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
        console.error('TESTING_EARLY_RECV=' + method + ' ' + url + ' ip=' + ip);
      } catch (e) {}
      try { next(); } catch (e) { next(e); }
    });
  }

  // Utility: persistent simple index for local storage fallback
  const STORAGE_DIR = path.resolve(__dirname, '..', 'evidence_storage');
  const INDEX_FILE = path.join(STORAGE_DIR, 'index.json');
  function ensureStorage() {
    ensureDir(STORAGE_DIR);
    if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, JSON.stringify({ entries: [] }, null, 2));
  }
  function saveIndex(entry) {
    try {
      const raw = fs.readFileSync(INDEX_FILE, 'utf8');
      const json = JSON.parse(raw || '{"entries":[]}');
      json.entries.unshift(entry);
      fs.writeFileSync(INDEX_FILE, JSON.stringify(json, null, 2));
    } catch (e) {
      // best-effort: write fresh file
      fs.writeFileSync(INDEX_FILE, JSON.stringify({ entries: [entry] }, null, 2));
    }
  }

  function base64ToBuffer(b64) { return Buffer.from(b64, 'base64'); }

  async function storeLocal(buf, filename) {
    const dest = path.join(STORAGE_DIR, filename);
    fs.writeFileSync(dest, buf);
    return { cid: `file://${dest}`, uri: `file://${dest}` };
  }

  async function storeToHeliaOrLocal(buf, filename, app) {
    // prefer Helia runtime if available (app.locals.heliaRuntime or heliaRuntime global)
    const heliaLocal = (app && app.locals && app.locals.heliaRuntime) ? app.locals.heliaRuntime : heliaRuntime;
    if (heliaLocal) {
      try {
        const data = (uint8arrays && uint8arrays.fromString) ? uint8arrays.fromString(buf.toString('utf8'), 'utf8') : buf;
        // try multiple unixfs APIs
        if (heliaLocal.ufs && typeof heliaLocal.ufs.addBytes === 'function') {
          const cid = await heliaLocal.ufs.addBytes(data);
          return { cid: cid.toString(), uri: `ipfs://${cid.toString()}` };
        } else if (heliaLocal.ufs && typeof heliaLocal.ufs.add === 'function') {
          const out = await heliaLocal.ufs.add(data);
          if (out) return { cid: out.cid.toString(), uri: `ipfs://${out.cid.toString()}` };
        } else if (heliaLocal.ufs && typeof heliaLocal.ufs.addAll === 'function') {
          for await (const item of heliaLocal.ufs.addAll([{ content: data }])) {
            if (item && item.cid) return { cid: item.cid.toString(), uri: `ipfs://${item.cid.toString()}` };
          }
        } else if (heliaLocal.node && heliaLocal.node.block && typeof heliaLocal.node.block.put === 'function') {
          const p = await heliaLocal.node.block.put(data);
          if (p && p.cid) return { cid: p.cid.toString(), uri: `ipfs://${p.cid.toString()}` };
        }
      } catch (e) {
        console.warn('Helia storage failed, falling back to local:', e && e.message ? e.message : e);
      }
    }
    // fallback
    return await storeLocal(buf, filename);
  }

  // merge-in /submit-evidence route (improved: digest verification + Helia fallback + no decryption)
  exportedApp.post('/submit-evidence', async (req, res) => {
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
      // Validate input: accept either a base64 ciphertext field or a canonical cipher JSON wrapper
        const providedDigest = payload && payload.digest ? String(payload.digest) : null;
        const base64Cipher = payload && payload.ciphertext ? payload.ciphertext : null;
        const wrapper = payload && payload.version && payload.crypto && typeof payload.crypto === 'object' ? payload : null;

        if (!providedDigest) return res.status(400).json({ error: 'digest required (0x.. bytes32)' });

        // Compute server digest depending on input form.
        let serverDigest = null;
        if (base64Cipher) {
          // client provided raw ciphertext bytes (base64) — compute keccak256 over raw bytes
          const buf = base64ToBuffer(base64Cipher);
          serverDigest = (require('ethers').utils || require('ethers')).keccak256(buf);
        } else if (wrapper) {
          // compute canonical JSON digest (legacy form)
          const canonical = canon(wrapper);
          try {
            serverDigest = require('ethers').utils ? require('ethers').utils.keccak256(require('ethers').utils.toUtf8Bytes(canonical)) : keccak256(toUtf8Bytes(canonical));
          } catch (e) {
            const ethers = require('ethers');
            serverDigest = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(canonical));
          }
        } else {
          // fallback: if payload is string/plaintext provided directly, hash UTF-8 bytes
          const txt = typeof payload === 'string' ? payload : JSON.stringify(payload);
          const ethers = require('ethers');
          serverDigest = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(txt));
        }

        if (serverDigest !== providedDigest) {
          return res.status(400).json({ error: 'digest_mismatch', serverDigest, providedDigest });
        }

        // store the raw data: prefer Helia if available, otherwise local storage. Do NOT decrypt.
        ensureStorage();
        const filename = `${Date.now()}-${serverDigest.replace(/^0x/, '')}.bin`;
        let storeResult = null;
        try {
          if (base64Cipher) {
            const buf = base64ToBuffer(base64Cipher);
            storeResult = await storeToHeliaOrLocal(buf, filename, exportedApp);
          } else if (wrapper) {
            const canonical = canon(wrapper);
            const buf = Buffer.from(canonical, 'utf8');
            storeResult = await storeToHeliaOrLocal(buf, filename, exportedApp);
          } else {
            const txt = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const buf = Buffer.from(txt, 'utf8');
            storeResult = await storeToHeliaOrLocal(buf, filename, exportedApp);
          }
        } catch (e) {
          // fallback to local storage on error
          try { ensureStorage(); } catch (e2) {}
          if (base64Cipher) {
            const buf = base64ToBuffer(base64Cipher);
            storeResult = await storeLocal(buf, filename);
          } else if (wrapper) {
            const canonical = canon(wrapper);
            const buf = Buffer.from(canonical, 'utf8');
            storeResult = await storeLocal(buf, filename);
          } else {
            const txt = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const buf = Buffer.from(txt, 'utf8');
            storeResult = await storeLocal(buf, filename);
          }
        }

        // record metadata in index
        const entry = {
          digest: serverDigest,
          cid: storeResult.cid,
          uri: storeResult.uri,
          reporterAddress: payload.reporterAddress || null,
          contractAddress: payload.contractAddress || null,
          note: payload.note || null,
          encryption: payload.encryption || null,
          timestamp: payload.timestamp || new Date().toISOString()
        };
        saveIndex(entry);

    // Prepare response object
    const responseObj = { success: true, cid: storeResult.cid, uri: storeResult.uri, digest: serverDigest };

    // Send response to client
    res.json(responseObj);

    // Persist a copy of the response JSON to evidence_storage for debugging/audit
    try {
      ensureStorage();
      const respFilename = `${Date.now()}-${String(serverDigest).replace(/^0x/, '')}.json`;
      const respPath = path.join(STORAGE_DIR, respFilename);
      fs.writeFileSync(respPath, JSON.stringify(responseObj, null, 2), { encoding: 'utf8' });
      console.log('Saved submit-evidence response to', respPath);
    } catch (e) {
      console.error('Failed to persist submit-evidence response:', e && e.message ? e.message : e);
    }
    return;
    } catch (err) {
      try { if (process.env && process.env.TESTING) console.error('TESTING_SUBMIT_ERROR=' + (err && err.stack ? err.stack : String(err))); } catch (e) {}
      console.error('submit-evidence error', err && err.stack ? err.stack : err);
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  });

  // Lightweight ping endpoint useful for Playwright to confirm connectivity from the browser
  exportedApp.get('/ping', (req, res) => {
    try { return res.json({ ok: true, ts: Date.now() }); } catch (e) { return res.status(500).json({ ok: false }); }
  });

  exportedApp.get('/health', (req, res) => res.json({ ok: true, staticDir: staticDirLocal }));

  // register-dispute endpoint to link txHash to existing digest/cid
  exportedApp.post('/register-dispute', async (req, res) => {
    try {
      const { txHash, digest, cid, contractAddress, reporterAddress } = req.body || {};
      if (!txHash || !digest) return res.status(400).json({ error: 'txHash and digest required' });
      ensureStorage();
      const raw = fs.readFileSync(INDEX_FILE, 'utf8');
      const json = JSON.parse(raw || '{"entries":[]}');
      const idx = json.entries.findIndex(e => e.digest === digest);
      if (idx >= 0) {
        json.entries[idx].txHash = txHash;
        json.entries[idx].registeredAt = new Date().toISOString();
        if (cid) json.entries[idx].cid = cid;
        if (contractAddress) json.entries[idx].contractAddress = contractAddress;
        if (reporterAddress) json.entries[idx].reporterAddress = reporterAddress;
        fs.writeFileSync(INDEX_FILE, JSON.stringify(json, null, 2));
        return res.json({ success: true, entry: json.entries[idx] });
      }
      const newEntry = { digest, txHash, cid: cid || null, contractAddress: contractAddress || null, reporterAddress: reporterAddress || null, registeredAt: new Date().toISOString() };
      json.entries.unshift(newEntry);
      fs.writeFileSync(INDEX_FILE, JSON.stringify(json, null, 2));
      return res.json({ success: true, entry: newEntry });
    } catch (err) {
      console.error('register-dispute error', err && err.stack ? err.stack : err);
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  });

  // Initialize Helia modules and runtime now (Helia is required). Start Helia before listening
  // so the server only announces readiness once Helia is available. This prevents tests
  // that rely on publish functionality from racing with Helia startup.
  await initHeliaIfNeeded();
  attachHeliaToApp(exportedApp);

  const server = await new Promise((resolve, reject) => {
    const s = exportedApp.listen(port, '127.0.0.1', function() {
      resolve(s);
    });
    s.on('error', reject);
  });

  // Log listening immediately so test harnesses can detect readiness quickly
  try {
    const addrNow = server.address && server.address();
    const listenPortNow = addrNow && addrNow.port ? addrNow.port : port;
    console.log(`Evidence endpoint listening on http://127.0.0.1:${listenPortNow} (static dir: ${staticDirLocal})`);
  } catch (e) {}

  let actualPort = port;
  try {
    const addr = server.address();
    if (addr && addr.port) actualPort = addr.port;
  } catch (e) {}
  console.log(`Evidence endpoint listening on http://127.0.0.1:${actualPort} (static dir: ${staticDirLocal})`);
  try {
    if (process.env && process.env.TESTING) {
      let hasSecp = false;
      try { require.resolve('secp256k1'); hasSecp = true; } catch (e) {}
      console.error('TESTING_ENDPOINT_ENV node=' + (process && process.versions && process.versions.node) + ' secp256k1=' + String(hasSecp));
    }
  } catch (e) {}
  return server;
}

// Stop server and gracefully shutdown Helia runtime (if running). Returns a Promise that resolves when shutdown completes.
async function stopEvidenceEndpoint(server) {
  try {
    if (server && typeof server.close === 'function') {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    }
  } catch (e) {
    // ignore server close errors
  }
  // Shutdown helia runtime
  if (heliaRuntime && heliaRuntime.node) {
    try {
      if (typeof heliaRuntime.node.stop === 'function') {
        await heliaRuntime.node.stop();
      } else if (typeof heliaRuntime.node.close === 'function') {
        await heliaRuntime.node.close();
      }
    } catch (e) {
      // best-effort
    }
  }
  heliaRuntime = null;
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

module.exports = { startEvidenceEndpoint, stopEvidenceEndpoint, initHeliaIfNeeded, attachHeliaToApp, normalizePublicKeyToBuffer };
