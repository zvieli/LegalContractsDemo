import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import cors from 'cors';
import https from 'https';
import http from 'http';

// Load environment (tools/ipfs/.env)
dotenv.config({ path: path.join(process.cwd(), 'tools', 'ipfs', '.env') });

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));

const storeDir = path.join(process.cwd(), 'tools', 'ipfs', 'store');
fs.ensureDirSync(storeDir);

// Configure CORS: allow origins configured via env or default to localhost dev origins
const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({ origin: function(origin, cb) {
  // allow requests with no origin (e.g., curl/postman)
  if (!origin) return cb(null, true);
  if (allowed.indexOf(origin) !== -1) return cb(null, true);
  return cb(new Error('Origin not allowed by CORS'));
}}));

// Simple API key middleware for protected endpoints
function requireApiKey(req, res, next) {
  const key = process.env.PIN_SERVER_API_KEY || null;
  if (!key) return next(); // no key configured -> open mode
  const provided = (req.headers['x-api-key'] || req.query.api_key || '').toString();
  if (!provided || provided !== key) return res.status(401).json({ error: 'invalid api key' });
  return next();
}

app.post('/pin', requireApiKey, async (req, res) => {
  try {
    const { cipherStr, meta } = req.body;
    if (!cipherStr) return res.status(400).send({ error: 'cipherStr required' });

    // Prefer local IPFS HTTP API (docker). If not available, fall back to an in-process ipfs-core node.
    const apiBase = process.env.IPFS_API_BASE || 'http://127.0.0.1:5001';
    let cid = null;
    let parsed = null;
    let used = 'api';
    try {
      // Check IPFS API health
      const versionUrl = `${apiBase}/api/v0/version`;
      const vres = await fetch(versionUrl, { method: 'POST' }).catch(() => null);
      if (vres && vres.ok) {
        // call add endpoint
        const addUrl = `${apiBase}/api/v0/add?pin=true`;
        // go-ipfs expects multipart; we can send plain body and parse but better to call the simple add via body
        const resp = await fetch(addUrl, { method: 'POST', body: Buffer.from(cipherStr, 'utf8') });
        const text = await resp.text();
        try { parsed = JSON.parse(text.trim().split('\n').slice(-1)[0]); } catch (e) { parsed = { raw: text }; }
        cid = parsed && parsed.Hash ? parsed.Hash : null;
      } else {
  used = 'ipfs-core';
  // fallback to ipfs-core in-process
  const Ipfs = await import('ipfs-core');
  // create ephemeral repo under OS temp dir to avoid collisions with existing ~/.jsipfs locks
  const repoPath = path.join(os.tmpdir(), `pin-server-ipfs-repo-${uuidv4()}`);
  const node = await Ipfs.create({ repo: repoPath, config: { Addresses: { Swarm: [] } } });
  const { cid: added } = await node.add(Buffer.from(cipherStr, 'utf8'));
  cid = added.toString();
  parsed = { added: cid };
  // stop the node (optional) — keep it running would add memory; we stop to be stateless
  try { await node.stop(); } catch (_) {}
      }
    } catch (e) {
      // As final fallback attempt ipfs-core
      try {
        used = 'ipfs-core';
        const Ipfs = await import('ipfs-core');
        const repoPath2 = path.join(os.tmpdir(), `pin-server-ipfs-repo-${uuidv4()}`);
  const node = await Ipfs.create({ repo: repoPath2, config: { Addresses: { Swarm: [] } } });
        const { cid: added } = await node.add(Buffer.from(cipherStr, 'utf8'));
        cid = added.toString();
        parsed = { added: cid };
        try { await node.stop(); } catch (_) {}
      } catch (err2) {
        // Final fallback: don't fail completely — persist the cipher locally for audit and allow admin decrypt
        console.warn('ipfs add failed with both api and ipfs-core fallbacks, saving local-only record', err2, e);
        cid = null;
        parsed = { error: String(err2 || e) };
        used = 'none';
        // continue — we'll persist the record below so admin can decrypt from saved cipher
      }
    }

  // save local copy for audit (include the raw cipherStr so admin can decrypt later)
  const id = uuidv4();
  const out = { id, cid, meta, createdAt: Date.now(), raw: parsed, cipherStrLength: cipherStr.length, used, cipherStrSample: cipherStr.slice(0, 400), cipherStrFull: cipherStr };
  await fs.writeFile(path.join(storeDir, `${id}.json`), JSON.stringify(out, null, 2), 'utf8');

    res.json(out);
  } catch (err) {
    console.error('pin error', err);
    res.status(500).send({ error: String(err) });
  }
});

app.get('/pin/:id', requireApiKey, async (req, res) => {
  try {
    const file = path.join(storeDir, `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    const txt = await fs.readFile(file, 'utf8');
    return res.type('application/json').send(txt);
  } catch (e) { res.status(500).send({ error: String(e) }); }
});
// Admin helper: decrypt a pinned item using ADMIN_PRIVATE_KEY (from tools/ipfs/.env)
app.post('/admin/decrypt/:id', requireApiKey, async (req, res) => {
  try {
    const file = path.join(storeDir, `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    const txt = await fs.readFile(file, 'utf8');
    const obj = JSON.parse(txt);
    // Prefer full cipher if stored; fall back to sample (legacy)
    const full = obj.cipherStrFull || null;
    const sample = obj.cipherStrSample || null;
    const cipherToUse = full || sample;
    if (!cipherToUse) return res.status(400).json({ error: 'no cipher text available to decrypt' });
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    if (!privateKey) return res.status(500).json({ error: 'ADMIN_PRIVATE_KEY not configured on server' });
    try {
      const EthCrypto = await import('eth-crypto');
      const parsed = EthCrypto.cipher.parse(cipherToUse);
      const decrypted = await EthCrypto.decryptWithPrivateKey(privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey, parsed);
      return res.json({ id: obj.id, decrypted });
    } catch (e) {
      console.error('decrypt error', e);
      return res.status(500).json({ error: String(e) });
    }
  } catch (e) { return res.status(500).json({ error: String(e) }); }
});

const port = process.env.PORT || 3002;
// If TLS env vars are provided, create an HTTPS server
const tlsKeyPath = process.env.TLS_KEY_PATH || process.env.TLS_KEY || null;
const tlsCertPath = process.env.TLS_CERT_PATH || process.env.TLS_CERT || null;
if (tlsKeyPath && tlsCertPath && fs.existsSync(tlsKeyPath) && fs.existsSync(tlsCertPath)) {
  const key = fs.readFileSync(tlsKeyPath);
  const cert = fs.readFileSync(tlsCertPath);
  https.createServer({ key, cert }, app).listen(port, () => console.log(`IPFS pin server (HTTPS) listening on :${port}`));
} else {
  http.createServer(app).listen(port, () => console.log(`IPFS pin server (HTTP) listening on :${port}`));
}
