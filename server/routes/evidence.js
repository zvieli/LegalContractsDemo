import express from 'express';
import path from 'path';
import { encryptForAdmin, decryptForAdmin } from '../lib/eciesServer.js';
import { uploadPayload } from '../lib/heliaUploader.js';
import { getProvider, getProviderSync } from '../lib/getProvider.js';
import * as heliaService from '../modules/helia/heliaService.js';
import fs from 'fs';
import { ethers } from 'ethers';

const router = express.Router();

// POST /api/start-appeal
// body: { contractAddress, fromBlock?, toBlock?, abiPaths? }
// Collects contract history, uploads it to Helia (via uploadPayload) and returns a historyRef (cid)
// NOTE: start-appeal endpoint deprecated on server. Frontend should collect history and POST to /api/submit-appeal
router.post('/start-appeal', async (req, res) => {
  return res.status(501).json({ error: 'server-side history collection disabled; use client-side collectTransactionHistory and submit to /api/submit-appeal' });
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
        // Server-side history collection is deprecated. Expect clients to upload historyRef or inlineHistory.
        history = [];
      }
    } catch (e) {
      console.warn('[submit-appeal] history resolution error', e && e.message);
    }

    // If the client provided a signedPayload + signature, verify EIP-191 signature here and prefer signedPayload as the authoritative canonical payload
    let payloadRef = null;
    const { signedPayload, signature, signerAddress } = body || {};
    let envelopeUploadResult = null;
    let digest = null;
    if (signedPayload && signature && signerAddress) {
      try {
        const recovered = ethers.verifyMessage(String(signedPayload), String(signature));
        if ((recovered || '').toLowerCase() !== String(signerAddress).toLowerCase()) {
          return res.status(400).json({ error: 'signature verification failed', recovered, signerAddress });
        }

        // Try to parse the signedPayload as JSON; if parse fails, store as raw string
        let parsedPayload = null;
        try { parsedPayload = JSON.parse(String(signedPayload)); } catch (e) { parsedPayload = null; }

        // Filter payload to only allowed fields to enforce reduced schema
        const allowed = ['contractAddress','contractType','plaintiff','defendant','txHistory','complaint','requestedAmount'];
        let filteredPayload = null;
        if (parsedPayload && typeof parsedPayload === 'object') {
          filteredPayload = {};
          for (const k of allowed) {
            if (Object.prototype.hasOwnProperty.call(parsedPayload, k)) filteredPayload[k] = parsedPayload[k];
          }
        } else {
          // If it's not parseable JSON, we still store the raw string under a canonical key
          filteredPayload = { canonical: String(signedPayload) };
        }

        // Upload the raw canonical payload separately (this will be the primary payloadRef)
        try {
          const payloadUpload = await uploadPayload(JSON.stringify(filteredPayload), { name: `canonical_${contractAddress}` });
          payloadRef = payloadUpload.uri || payloadUpload.http || payloadUpload.path || payloadUpload.cid || null;
        } catch (e) {
          console.error('[submit-appeal] payload upload failed', e && e.message);
          payloadRef = null;
        }

        // Prepare an admin envelope containing the filtered payload plus signature for auditing
        const combinedForAdmin = { payload: filteredPayload, signature: String(signature), signerAddress: String(signerAddress) };

        // Prepare encryption: encrypt to admin pubkey if requested
        const adminPub = process.env.ADMIN_PUBLIC_KEY;
        let envelope = null;
        if (encryptToAdmin) {
          if (!adminPub) return res.status(500).json({ error: 'ADMIN_PUBLIC_KEY not configured on server' });
          const enc = await encryptForAdmin(JSON.stringify(combinedForAdmin), adminPub);
          envelope = enc.envelope || enc;
          digest = enc.digest || null;
        } else {
          envelope = { plaintext: combinedForAdmin };
          digest = null;
        }

        try {
          envelopeUploadResult = await uploadPayload(JSON.stringify(envelope), { name: `evidence_${contractAddress}` });
        } catch (e) {
          console.error('[submit-appeal] envelope upload failed', e && e.message);
          envelopeUploadResult = null;
        }

      } catch (e) {
        return res.status(400).json({ error: 'signature verification error', details: String(e && e.message) });
      }
    } else {
      // No signedPayload provided: fall back to storing userEvidence if present
      if (userEvidence) {
        try {
          const complaintUpload = await uploadPayload(typeof userEvidence === 'string' ? userEvidence : JSON.stringify(userEvidence), { name: `complaint_${contractAddress}` });
          payloadRef = complaintUpload.uri || complaintUpload.http || complaintUpload.path || complaintUpload.cid || null;
        } catch (e) {
          console.error('[submit-appeal] complaint upload failed', e && e.message);
        }
      }

      // For non-signed flows, also create an envelope with minimal context if admin encryption requested
      if (encryptToAdmin) {
        const adminPub = process.env.ADMIN_PUBLIC_KEY;
        if (!adminPub) return res.status(500).json({ error: 'ADMIN_PUBLIC_KEY not configured on server' });
        const combined = { contractAddress, history: (Array.isArray(history) && history.length) ? history : null, historyRef: resolvedHistoryRef, metadata: metadata || {}, complaintRef: payloadRef, userEvidence: userEvidence && !payloadRef ? userEvidence : null };
        const enc = await encryptForAdmin(JSON.stringify(combined), adminPub);
        try {
          envelopeUploadResult = await uploadPayload(JSON.stringify(enc.envelope || enc), { name: `evidence_${contractAddress}` });
          digest = enc.digest || null;
        } catch (e) {
          console.error('[submit-appeal] envelope upload failed', e && e.message);
          envelopeUploadResult = null;
        }
      }
    }

    const evidenceRef = envelopeUploadResult ? (envelopeUploadResult.uri || envelopeUploadResult.http || envelopeUploadResult.path || envelopeUploadResult.cid || null) : null;
    return res.json({ evidenceRef, payloadRef, digest, upload: envelopeUploadResult });
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
