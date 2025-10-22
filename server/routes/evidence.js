import express from 'express';
import path from 'path';
import { collectContractHistory } from '../lib/collectHistory.js';
import { encryptForAdmin, decryptForAdmin } from '../lib/eciesServer.js';
import { uploadPayload } from '../lib/heliaUploader.js';
import { getProvider, getProviderSync } from '../lib/getProvider.js';
import * as heliaService from '../modules/helia/heliaService.js';
import fs from 'fs';

const router = express.Router();

// POST /api/start-appeal
// body: { contractAddress, fromBlock?, toBlock?, abiPaths? }
// Collects contract history, uploads it to Helia (via uploadPayload) and returns a historyRef (cid)
router.post('/start-appeal', async (req, res) => {
  try {
    const body = req.body || {};
    const { contractAddress, fromBlock, toBlock, abiPaths: abiPathsBody } = body;
    if (!contractAddress) return res.status(400).json({ error: 'contractAddress required' });

    const provider = await getProvider();

    const abiPathsEnv = process.env.EVIDENCE_ABI_PATHS || '';
    const abiPaths = Array.isArray(abiPathsBody) && abiPathsBody.length ? abiPathsBody
      : (abiPathsEnv ? abiPathsEnv.split(',').map(p => path.resolve(p)) : []);

    let history = [];
    try {
      history = await collectContractHistory(provider, contractAddress, abiPaths.length ? abiPaths : [path.resolve('artifacts', 'contracts')], fromBlock || 0, toBlock || 'latest');
    } catch (err) {
      console.warn('[start-appeal] collectContractHistory failed, proceeding with empty history. error=', err && (err.message || err));
      history = [];
    }

    const payload = {
      contractAddress,
      collectedAt: Date.now(),
      history,
      server: { hostname: process.env.HOSTNAME || null }
    };

    let uploadResult = null;
    try {
      uploadResult = await uploadPayload(JSON.stringify(payload), { name: `history_${contractAddress}` });
    } catch (e) {
      console.error('[start-appeal] upload failed', e && e.message);
      return res.status(500).json({ error: 'failed to store history', details: String(e && e.message) });
    }

    const historyRef = uploadResult.uri || uploadResult.http || uploadResult.path || uploadResult.cid || null;
    return res.json({ historyRef, upload: uploadResult });
  } catch (e) {
    console.error('[/api/start-appeal] error', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// POST /api/submit-appeal
// body: { contractAddress, userEvidence, fromBlock?, toBlock? }
router.post('/submit-appeal', async (req, res) => {
  try {
    // Accept both JSON and legacy plaintext ciphertexts
    const body = req.body || {};
    const { contractAddress, userEvidence, complaintCid, historyRef, inlineHistory = false, fromBlock, toBlock, metadata, recipients, encryptToAdmin = true } = body;
    if (!contractAddress) return res.status(400).json({ error: 'contractAddress required' });

  // Provider - prefer local Hardhat when available
  const provider = await getProvider();

    // ABI paths from env or default
    const abiPathsEnv = process.env.EVIDENCE_ABI_PATHS || '';
    const abiPaths = abiPathsEnv ? abiPathsEnv.split(',').map(p => path.resolve(p)) : [];

    // Determine history: if caller supplied a historyRef (CID/URI) we will use it instead of re-running collectContractHistory.
    let history = [];
    let resolvedHistoryRef = null;
    try {
      if (historyRef) {
        // normalize schemes like helia:// or ipfs://
        resolvedHistoryRef = String(historyRef).replace(/^helia:\/\//i, '').replace(/^ipfs:\/\//i, '');
        if (inlineHistory) {
          try {
            const content = await heliaService.getEvidenceFromHelia(resolvedHistoryRef);
            try { history = JSON.parse(content); } catch (e) { history = content; }
          } catch (e) {
            console.warn('[submit-appeal] failed to inline history from helia', e && e.message);
            history = [];
          }
        }
      } else {
        try {
          history = await collectContractHistory(provider, contractAddress, abiPaths.length ? abiPaths : [path.resolve('artifacts', 'contracts')], fromBlock || 0, toBlock || 'latest');
        } catch (err) {
          console.warn('[submit-appeal] collectContractHistory failed, proceeding with empty history. error=', err && (err.message || err));
          history = [];
        }
      }
    } catch (e) {
      console.warn('[submit-appeal] history resolution error', e && e.message);
    }

    // If complaintCid not provided but userEvidence raw text is, upload complaint to Helia to obtain a complaintCid
    let resolvedComplaintRef = complaintCid || null;
    if (!resolvedComplaintRef && userEvidence) {
      try {
        const complaintUpload = await uploadPayload(typeof userEvidence === 'string' ? userEvidence : JSON.stringify(userEvidence), { name: `complaint_${contractAddress}` });
        resolvedComplaintRef = complaintUpload.uri || complaintUpload.http || complaintUpload.path || complaintUpload.cid || null;
      } catch (e) {
        console.error('[submit-appeal] complaint upload failed', e && e.message);
      }
    }

    const combined = {
      contractAddress,
      collectedAt: Date.now(),
      // include inline history if available, otherwise reference by historyRef when provided
      history: (Array.isArray(history) && history.length) ? history : null,
      historyRef: resolvedHistoryRef,
      metadata: metadata || {},
      complaintRef: resolvedComplaintRef,
      userEvidence: userEvidence && !resolvedComplaintRef ? userEvidence : null,
      server: { hostname: process.env.HOSTNAME || null }
    };

    // Prepare encryption: encrypt to admin pubkey if requested
    const adminPub = process.env.ADMIN_PUBLIC_KEY;
    let envelope = null;
    let digest = null;
    if (encryptToAdmin) {
      if (!adminPub) return res.status(500).json({ error: 'ADMIN_PUBLIC_KEY not configured on server' });
      const enc = await encryptForAdmin(JSON.stringify(combined), adminPub);
      envelope = enc.envelope || enc;
      digest = enc.digest || null;
    } else {
      // store plaintext as envelope for now (not recommended)
      envelope = { plaintext: combined };
      digest = null;
    }

    // Upload using the unified uploader which will use heliaService and chunking/manifest as needed
    let uploadResult = null;
    try {
      uploadResult = await uploadPayload(JSON.stringify(envelope), { name: `evidence_${contractAddress}` });
    } catch (e) {
      console.error('[submit-appeal] upload failed', e && e.message);
      return res.status(500).json({ error: 'failed to store evidence', details: String(e && e.message) });
    }
    const evidenceRef = uploadResult.uri || uploadResult.http || uploadResult.path || uploadResult.cid || null;
    return res.json({ evidenceRef, digest, upload: uploadResult });
  } catch (e) {
    console.error('[/api/submit-appeal] error', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// Admin-only preview endpoint: fetch stored envelope and decrypt with server private key
// Requires ADMIN_PREVIEW_KEY env var to be set and client to provide header x-admin-key
router.post('/preview-evidence', async (req, res) => {
  try {
    const adminKey = process.env.ADMIN_PREVIEW_KEY || process.env.ADMIN_PREVIEW || null;
    const provided = req.headers['x-admin-key'];
    // Fallback: allow header to match ADMIN_PRIVATE_KEY (common env name in repo)
    const adminPrivateKeyEnv = process.env.ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIV_KEY || null;
    const isAllowed = (adminKey && provided && provided === adminKey) || (adminPrivateKeyEnv && provided && provided === adminPrivateKeyEnv);
    if (!isAllowed) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }

    const { evidenceRef } = req.body || {};
    if (!evidenceRef) return res.status(400).json({ success: false, error: 'evidenceRef required' });

    let envelopeRaw = null;
    // helia://CID   ipfs://CID   file://path
    if (evidenceRef.startsWith('helia://')) {
      const cid = evidenceRef.replace('helia://', '');
      if (!heliaService || typeof heliaService.getEvidenceFromHelia !== 'function') {
        return res.status(500).json({ success: false, error: 'helia service unavailable' });
      }
      envelopeRaw = await heliaService.getEvidenceFromHelia(cid);
    } else if (evidenceRef.startsWith('ipfs://')) {
      // try local helia as well
      const cid = evidenceRef.replace('ipfs://', '');
      envelopeRaw = await heliaService.getEvidenceFromHelia(cid);
    } else if (evidenceRef.startsWith('file://')) {
      const fp = evidenceRef.replace('file://', '');
      const abs = path.isAbsolute(fp) ? fp : path.join(process.cwd(), fp);
      envelopeRaw = fs.readFileSync(abs, 'utf8');
    } else if (evidenceRef.startsWith('http://') || evidenceRef.startsWith('https://')) {
      const r = await fetch(evidenceRef);
      if (!r.ok) throw new Error('failed to fetch evidenceRef');
      envelopeRaw = await r.text();
    } else {
      // treat as raw JSON
      envelopeRaw = evidenceRef;
    }

    if (!envelopeRaw) return res.status(404).json({ success: false, error: 'not found' });

    // Parse envelope
    let envelope = null;
    try {
      envelope = typeof envelopeRaw === 'string' ? JSON.parse(envelopeRaw) : envelopeRaw;
    } catch (e) {
      // if not JSON, assume it's base64-encoded envelope
      try {
        const buf = Buffer.from(String(envelopeRaw), 'base64').toString('utf8');
        envelope = JSON.parse(buf);
      } catch (e2) {
        return res.status(400).json({ success: false, error: 'invalid envelope format' });
      }
    }

  // Use ADMIN_PRIV_KEY or fallback to ADMIN_PRIVATE_KEY (repo uses ADMIN_PRIVATE_KEY)
  const adminPriv = process.env.ADMIN_PRIV_KEY || process.env.ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIV || null;
  if (!adminPriv) return res.status(500).json({ success: false, error: 'server missing ADMIN_PRIV_KEY / ADMIN_PRIVATE_KEY' });

  const plaintext = await decryptForAdmin(envelope, adminPriv);
    res.json({ success: true, plaintext });
  } catch (err) {
    console.error('preview-evidence error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
