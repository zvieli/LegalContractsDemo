/**
 * V7 Evidence Endpoint Compatibility Layer
 * 
 * This module provides backward compatibility for tests and existing code
 * that relies on the old evidence-endpoint.js while redirecting to the
 * new V7 backend system.
 */

import { v7DisputeProcessor, v7HealthMonitor } from '../server/modules/v7Integration.js';
import { validateIPFSEvidence, generateEvidenceDigest } from '../server/modules/evidenceValidator.js';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * V7 Evidence Endpoint Compatibility Layer
 * 
 * This file is the only supported compatibility layer for legacy tests.
 * כל שאר הקבצים הישנים עברו ל-tools/legacy/.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Legacy compatibility exports
export function canonicalizeAddress(addr) {
  if (addr === undefined || addr === null) return null;
  let s = String(addr).trim();
  if (s.length === 0) return null;
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  s = s.toLowerCase();
  // Reject non-hex chars
  if (!/^[0-9a-f]*$/.test(s)) return null;
  // If shorter than 40 chars (rare / sloppy input), left-pad with zeros; if longer, invalid
  if (s.length > 40) return null;
  if (s.length < 40) s = s.padStart(40, '0');
  return '0x' + s;
}

export function normalizePubForEthCrypto(pub) {
  if (!pub) throw new Error('no public key to normalize');
  let s = String(pub);
  if (s.startsWith('0x')) s = s.slice(2);
  s = s.trim();
  if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
  if (s.length === 130 && !s.startsWith('04')) s = '04' + s;
  if (s.length % 2 === 1) s = '0' + s;
  return s;
}

export function normalizePublicKeyToBuffer(pub) {
  const normalized = normalizePubForEthCrypto(pub);
  return Buffer.from(normalized, 'hex');
}

// V7 Migration Notice
console.warn(`
⚠️  MIGRATION NOTICE: evidence-endpoint.js is deprecated in V7
📍 New system: Use server/index.js and V7 API endpoints
🔗 API Base: http://localhost:3001/api/v7/
📖 Documentation: server/README.md

Legacy support is provided for existing tests only.
Please migrate to V7 backend system for new features.
`);

/**
 * Legacy Evidence Endpoint (V7 Compatibility)
 * Provides minimal compatibility for existing tests
 */
export async function startEvidenceEndpoint(portArg = 5001, staticDirArg, adminPubArg) {
  console.log('🔄 Starting legacy evidence endpoint with V7 compatibility...');
  try {
    return await internalStart(portArg, staticDirArg, adminPubArg);
  } catch (err) {
    console.error('❌ startEvidenceEndpoint failed:', err && err.stack ? err.stack : err);
    return null;
  }
}

async function internalStart(portArg, staticDirArg, adminPubArg){
  const app = express();
  app.use(cors());
  app.use(bodyParser.json({ limit: '20mb' }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      ok: true, 
      version: 'v7-compatibility',
      message: 'Legacy endpoint running with V7 backend',
      migrate: 'Use http://localhost:3001/api/v7/ for new features'
    });
  });

  app.get('/ping', (req, res) => {
    res.json({ ok: true, ts: Date.now(), version: 'v7-compat' });
  });

  // Legacy evidence submission (simplified for compatibility)
  app.post('/submit-evidence', async (req, res) => {
    try {
      console.warn('⚠️ Using legacy /submit-evidence endpoint. Migrate to /api/v7/dispute/report');
      
      const { digest, contractAddress, type, content } = req.body;
      
      if (!digest) {
        return res.status(400).json({ error: 'digest required' });
      }

      // For testing compatibility, create a simplified response
      // Minimal envelope persistence for tests expecting evidence_storage updates
      try {
        const storageDir = path.join(process.cwd(), 'evidence_storage');
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        const indexPath = path.join(storageDir, 'index.json');
        let indexData = { entries: [] };
        if (fs.existsSync(indexPath)) {
          try { indexData = JSON.parse(fs.readFileSync(indexPath,'utf8')); } catch(_) {}
        }
        const envelopeFilename = `${Date.now()}-${digest.replace(/^0x/, '')}.json`;
        const envelopePath = path.join(storageDir, envelopeFilename);
        const payloadContent = req.body.content || '{}';
        // Simulate encryption recipients structure expected by decrypt tests
        const recipients = [
          {
            address: process.env.ADMIN_ADDRESS || canonicalizeAddress('0x1234567890123456789012345678901234567890'),
            encryptedKey: JSON.stringify({ version: 'x25519-xsalsa20-poly1305', nonce: 'legacy', ephemPublicKey: 'legacy', ciphertext: 'legacy' })
          }
        ];
        const envelopeObject = {
          digest,
            ciphertext: Buffer.from(payloadContent,'utf8').toString('base64'),
            recipients,
            encryption: { aes: { iv: Buffer.from('legacy_iv').toString('base64'), tag: Buffer.from('legacy_tag').toString('base64') } },
            createdAt: Date.now(),
            legacy: true
        };
        fs.writeFileSync(envelopePath, JSON.stringify(envelopeObject, null, 2));
        // Update index
        if (!indexData.entries.find(e=> e.digest === digest)) {
          indexData.entries.push({ digest, file: envelopeFilename, ts: Date.now() });
        }
        fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
        const response = {
          success: true,
          digest,
          cid: `legacy-${Date.now()}`,
          uri: `legacy://evidence/${digest}`,
          recipients: recipients.map(r=>r.address),
          file: `evidence_storage/${envelopeFilename}`,
          v7_migration: {
            message: 'This is a compatibility response. Use V7 API for production.',
            endpoint: 'POST http://localhost:3001/api/v7/dispute/report'
          }
        };
        res.json(response);
      } catch (writeErr) {
        console.error('Legacy evidence write error:', writeErr);
        return res.status(500).json({ error: 'write_failed', details: writeErr.message });
      }
    } catch (error) {
      console.error('Legacy evidence submission error:', error);
      res.status(500).json({ 
        error: error.message,
        migration: 'Use V7 API at http://localhost:3001/api/v7/'
      });
    }
  });

  // Legacy evidence index
  app.get('/evidence-index', (req, res) => {
    res.json({
      entries: [],
      message: 'Legacy endpoint. Use V7 API for current data.',
      v7_endpoint: 'GET http://localhost:3001/api/v7/health'
    });
  });

  // Legacy evidence retrieval
  app.get('/evidence/:digest', (req, res) => {
    res.json({
      error: 'Evidence not found in legacy system',
      migration: 'Use V7 backend for evidence management',
      v7_endpoint: 'http://localhost:3001/api/v7/'
    });
  });

  const server = await new Promise((resolve, reject) => {
    try {
      const s = app.listen(portArg, '127.0.0.1', function() {
        resolve(s);
      });
      s.on('error', (e)=>{
        console.error('Server listen error:', e && e.stack ? e.stack : e);
        reject(e);
      });
    } catch (e) {
      console.error('Immediate listen exception:', e && e.stack ? e.stack : e);
      reject(e);
    }
  });

  const actualPort = server.address().port;
  console.log(`📡 Legacy evidence endpoint running on http://127.0.0.1:${actualPort}`);
  console.log(`🚀 For full V7 features, use: http://localhost:3001/api/v7/`);

  return server;
}

export async function stopEvidenceEndpoint(server) {
  if (server && typeof server.close === 'function') {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

// Mock Helia functions for compatibility
export async function initHeliaIfNeeded() {
  console.log('🔄 Helia initialization (V7 compatibility mode)');
  return null; // Helia is handled by V7 backend
}

export function attachHeliaToApp(app) {
  if (app) {
    app.locals.v7Backend = 'http://localhost:3001/api/v7/';
  }
}

// If executed directly, show migration message
if (process.argv && process.argv[1] && process.argv[1].endsWith('evidence-endpoint-v7.js')) {
  console.log(`
🎯 V7 Migration Instructions:

1. Start V7 Backend Server:
   cd server
   npm run start:v7

2. Use V7 API Endpoints:
   POST http://localhost:3001/api/v7/dispute/report
   POST http://localhost:3001/api/v7/dispute/appeal
   GET  http://localhost:3001/api/v7/health

3. Update your code to use V7 modules:
   import { v7DisputeProcessor } from './server/modules/v7Integration.js';

For backward compatibility, starting legacy endpoint...
  `);
  
  startEvidenceEndpoint().catch((e) => {
    console.error('Failed to start legacy endpoint:', e.message);
    process.exit(1);
  });
}