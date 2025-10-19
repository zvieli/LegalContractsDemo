import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import * as heliaService from '../modules/helia/heliaService.js';

const DEFAULT_CHUNK_SIZE = 512 * 1024; // 512KB

/**
 * Simple uploader that tries Helia/remote HTTP endpoint if configured via HELIA_API
 * otherwise falls back to writing the payload to server/tmp/<digest>.json
 */
export async function uploadPayload(payloadBuffer, options = {}) {
  const heliaApi = process.env.HELIA_API || process.env.VITE_HELIA_API || null;
  const probeName = options.name || 'evidence';
  // If HELIA_API provided, POST payload (application/json) and expect { cid }
  if (heliaApi) {
    try {
      const res = await fetch(heliaApi, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payloadBuffer });
      if (!res.ok) throw new Error('upload failed status=' + res.status);
      const j = await res.json();
      // Expect j.cid or j.cidString
      const cid = j.cid || j.cidString || j.id || null;
      if (!cid) throw new Error('no cid returned from HELIA_API');
      return { cid, uri: `ipfs://${cid}`, http: `https://ipfs.io/ipfs/${cid}` };
    } catch (e) {
      console.warn('[heliaUploader] remote upload failed', e && e.message);
      // fallthrough to local write
    }
  }

  // Try to upload chunks using in-process Helia if available via heliaService
  try {
    // Convert payloadBuffer to Uint8Array if string
    const bytes = typeof payloadBuffer === 'string' ? new TextEncoder().encode(payloadBuffer) : (payloadBuffer instanceof Uint8Array ? payloadBuffer : new TextEncoder().encode(String(payloadBuffer)));
    if (bytes.length <= DEFAULT_CHUNK_SIZE) {
      try {
        const r = await heliaService.addEvidenceToHelia(bytes, probeName + '.json');
        return { cid: r.cid, uri: `ipfs://${r.cid}`, http: `https://ipfs.io/ipfs/${r.cid}`, size: r.size };
      } catch (e) {
        // fall through to remote fallback
      }
    }

    // Chunking path
    const chunks = [];
    for (let i = 0; i < bytes.length; i += DEFAULT_CHUNK_SIZE) {
      const slice = bytes.slice(i, i + DEFAULT_CHUNK_SIZE);
      try {
        const r = await heliaService.addEvidenceToHelia(slice, `${probeName}.part.${Math.floor(i / DEFAULT_CHUNK_SIZE)}`);
        chunks.push({ index: Math.floor(i / DEFAULT_CHUNK_SIZE), cid: r.cid, size: r.size });
      } catch (e) {
        console.warn('[heliaUploader] chunk upload failed, aborting chunking path', e && e.message);
        chunks.length = 0;
        break;
      }
    }
    if (chunks.length > 0) {
      // Build manifest
      const manifest = { version: 1, parts: chunks, totalSize: bytes.length, createdAt: Date.now(), name: probeName };
      const manifestCidObj = await heliaService.addEvidenceToHelia(JSON.stringify(manifest), probeName + '.manifest.json');
      return { cid: manifestCidObj.cid, uri: `ipfs://${manifestCidObj.cid}`, http: `https://ipfs.io/ipfs/${manifestCidObj.cid}`, manifest, parts: chunks };
    }
  } catch (e) {
    // fall through to file fallback
    console.warn('[heliaUploader] Helia in-process upload failed, falling back to write-to-file', e && e.message);
  }

  // local fallback: write to tmp with timestamp
  try {
    const tmpDir = path.resolve(process.cwd(), 'server', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const name = probeName.replace(/[^a-z0-9A-Z_-]/g, '_').slice(0,40) + '_' + Date.now();
    const filePath = path.join(tmpDir, name + '.json');
    fs.writeFileSync(filePath, typeof payloadBuffer === 'string' ? payloadBuffer : JSON.stringify(payloadBuffer), 'utf8');
    return { cid: null, uri: `file://${filePath}`, http: null, path: filePath };
  } catch (e) {
    throw new Error('failed to persist payload locally: ' + (e && e.message));
  }
}

export default { uploadPayload };
