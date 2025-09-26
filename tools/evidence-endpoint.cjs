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

const port = process.argv[2] ? Number(process.argv[2]) : 3000;
const staticDir = process.argv[3] ? process.argv[3] : path.join(__dirname, '..', 'front', 'e2e', 'static');

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
  if (process.env.ADMIN_PUBLIC_KEY) return process.env.ADMIN_PUBLIC_KEY;
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    try {
      const pk = fs.readFileSync(process.env.ADMIN_PRIVATE_KEY_FILE, 'utf8').trim();
      return EthCrypto.publicKeyByPrivateKey(pk);
    } catch (e) {
      console.warn('Could not read ADMIN_PRIVATE_KEY_FILE:', e.message);
    }
  }
  if (process.env.ADMIN_PRIVATE_KEY) {
    try {
      return EthCrypto.publicKeyByPrivateKey(process.env.ADMIN_PRIVATE_KEY.trim());
    } catch (e) {
      console.warn('Could not use ADMIN_PRIVATE_KEY:', e.message);
    }
  }
  // Dev fallback: generate keypair and print private key (not for production)
  const identity = EthCrypto.createIdentity();
  console.warn('No ADMIN key provided, generated dev keypair. Do NOT use in production. Admin private key:', identity.privateKey);
  return identity.publicKey;
}

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

ensureDir(staticDir);

const ADMIN_PUB = loadAdminPublicKey();

app.post('/submit-evidence', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) return res.status(400).json({ error: 'missing payload' });

    // Encrypt payload with admin public key using eth-crypto
    const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const encrypted = await EthCrypto.encryptWithPublicKey(ADMIN_PUB, plaintext);

    // canonicalize ciphertext JSON
    const canon = (obj) => {
      if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
      if (Array.isArray(obj)) return '[' + obj.map(canon).join(',') + ']';
      return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
    };

    const ciphertextJson = {
      version: '1',
      crypto: encrypted
    };

    const canonical = canon(ciphertextJson);

    // compute digest (ethers v5/v6 compat)
    let digest;
    try {
      digest = require('ethers').keccak256 ? require('ethers').keccak256(require('ethers').toUtf8Bytes(canonical)) : keccak256(toUtf8Bytes(canonical));
    } catch (e) {
      // fallback: use ethers.utils if present
      const ethers = require('ethers');
      digest = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(canonical));
    }

    const fileName = digest.replace(/^0x/, '') + '.json';
    const filePath = path.join(staticDir, fileName);
    fs.writeFileSync(filePath, canonical, 'utf8');

    return res.json({ digest, path: `/static/${fileName}`, file: filePath });
  } catch (err) {
    console.error('submit-evidence error', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, staticDir }));

app.listen(port, '127.0.0.1', () => {
  console.log(`Evidence endpoint listening on http://127.0.0.1:${port} (static dir: ${staticDir})`);
});
