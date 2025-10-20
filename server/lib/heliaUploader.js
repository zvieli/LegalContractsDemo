import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import * as heliaService from '../modules/helia/heliaService.js';

const DEFAULT_CHUNK_SIZE = 512 * 1024; // 512KB

/**
 * uploadPayload
 * - payload: string | Buffer | Uint8Array
 * - options: { name, chunkSize }
 * Returns a consistent object describing CID/uri and metadata
 */
export async function uploadPayload(payload, options = {}) {
  const heliaApi = process.env.HELIA_API || process.env.VITE_HELIA_API || null;
  const name = options.name || 'evidence';
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;

  // normalize to Uint8Array
  const bytes = (typeof payload === 'string') ? new TextEncoder().encode(payload) : (payload instanceof Uint8Array ? payload : new TextEncoder().encode(String(payload)));

  // 1) Try remote Helia API if configured
  if (heliaApi) {
    try {
      const res = await fetch(heliaApi, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(bytes) });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        const cid = j && (j.cid || j.id || j.cidString) || null;
        if (cid) return { cid, uri: `ipfs://${cid}`, http: `https://ipfs.io/ipfs/${cid}`, size: bytes.length };
      }
    } catch (e) {
      console.warn('[heliaUploader] remote HELIA_API upload failed', e && e.message);
    }
  }

  // 2) Try in-process Helia
  try {
    if (bytes.length <= chunkSize) {
      const r = await heliaService.addEvidenceToHelia(bytes, `${name}.json`);
      // in-process helia -> use helia:// scheme to indicate local helia store
      return { cid: r.cid, uri: `helia://${r.cid}`, http: `https://ipfs.io/ipfs/${r.cid}`, size: r.size };
    }

    // chunk
    const parts = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.slice(i, i + chunkSize);
      const r = await heliaService.addEvidenceToHelia(slice, `${name}.part.${Math.floor(i / chunkSize)}`);
      parts.push({ index: Math.floor(i / chunkSize), cid: r.cid, size: r.size });
    }
  const manifest = { version: 1, name, totalSize: bytes.length, parts, createdAt: Date.now() };
  const manifestObj = await heliaService.addEvidenceToHelia(JSON.stringify(manifest), `${name}.manifest.json`);
  return { cid: manifestObj.cid, uri: `helia://${manifestObj.cid}`, http: `https://ipfs.io/ipfs/${manifestObj.cid}`, manifest, parts };
  } catch (e) {
    console.warn('[heliaUploader] in-process Helia upload failed', e && e.message);
  }

  // 3) Fallback: write to local tmp and return file:// path
  try {
    const tmp = path.join(process.cwd(), 'server', 'tmp');
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
    const fname = path.join(tmp, `${name.replace(/[^a-z0-9A-Z_\-]/g, '_')}_${Date.now()}.json`);
    fs.writeFileSync(fname, Buffer.from(bytes));
    return { cid: null, uri: `file://${fname}`, path: fname, size: bytes.length };
  } catch (e) {
    throw new Error('heliaUploader: failed to persist payload: ' + (e && e.message));
  }
}

export default { uploadPayload };
