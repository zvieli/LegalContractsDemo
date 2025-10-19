import express from 'express';
import path from 'path';
import { collectContractHistory } from '../lib/collectHistory.js';
import { encryptForAdmin } from '../lib/eciesServer.js';
import { uploadPayload } from '../lib/heliaUploader.js';
import * as heliaService from '../modules/helia/heliaService.js';
import fs from 'fs';

const router = express.Router();

// POST /api/submit-appeal
// body: { contractAddress, userEvidence, fromBlock?, toBlock? }
router.post('/submit-appeal', async (req, res) => {
  try {
    // Accept both JSON and legacy plaintext ciphertexts
    const body = req.body || {};
    const { contractAddress, userEvidence, fromBlock, toBlock, metadata, recipients, encryptToAdmin = true } = body;
    if (!contractAddress) return res.status(400).json({ error: 'contractAddress required' });

    // Provider
    const rpc = process.env.RPC_URL || process.env.HARDHAT_RPC || 'http://127.0.0.1:8545';
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(rpc);

    // ABI paths from env or default
    const abiPathsEnv = process.env.EVIDENCE_ABI_PATHS || '';
    const abiPaths = abiPathsEnv ? abiPathsEnv.split(',').map(p => path.resolve(p)) : [];

    const history = await collectContractHistory(provider, contractAddress, abiPaths.length ? abiPaths : [path.resolve('artifacts', 'contracts')], fromBlock || 0, toBlock || 'latest');

    const combined = {
      contractAddress,
      collectedAt: Date.now(),
      history,
      metadata: metadata || {},
      userEvidence: userEvidence || null,
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

export default router;
