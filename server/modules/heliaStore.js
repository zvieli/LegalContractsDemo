import fs from 'fs';

const DEFAULT_HELIA_API = process.env.HELIA_LOCAL_API || 'http://127.0.0.1:5001';

// Optionally support in-process Helia via heliaLocal when heliaApi set to 'inproc' or 'inproc://default'
let heliaLocal = null;
async function ensureHeliaLocal() {
  if (heliaLocal) return heliaLocal;
  try {
    heliaLocal = await import('./heliaLocal.js');
    return heliaLocal;
  } catch (err) {
    // heliaLocal optional
    heliaLocal = null;
    return null;
  }
}

function parseAddResponse(text) {
  // ipfs add may return newline-separated JSON objects; find first JSON with Hash or CID
  try {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const l of lines) {
      try {
        const obj = JSON.parse(l);
        if (obj.Hash || obj.cid || obj.Cid) {
          return { cid: obj.Hash || obj.cid || obj.Cid, size: obj.Size || obj.size || null };
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {}
  return null;
}

export async function addEvidenceToHelia(content, filename = 'evidence.json', heliaApi = DEFAULT_HELIA_API) {
  // If explicitly requested, always use in-process Helia
  if (typeof heliaApi === 'string' && heliaApi.startsWith('inproc')) {
    const local = await ensureHeliaLocal();
    if (local) return await local.addEvidenceToLocalHelia(content, filename);
    // fallthrough to HTTP attempt if inproc import fails
  }

  // Prepare a small HTTP -> inproc fallback: try HTTP API first, but if it fails
  // (connection refused, parse error, non-OK), attempt the in-process Helia.
  const base = String(heliaApi || DEFAULT_HELIA_API).replace(/\/$/, '');
  const form = new FormData();
  const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content)], { type: 'application/json' });
  form.append('file', blob, filename);

  try {
    const resp = await fetch(`${base}/api/v0/add`, { method: 'POST', body: form, keepalive: false });
    const text = await resp.text();
    const parsed = parseAddResponse(text);
    if (parsed) return parsed;
    // If parsing failed, treat as an error to trigger inproc fallback
    throw new Error('Failed to parse Helia add response');
  } catch (httpErr) {
    console.warn('heliaStore: HTTP IPFS add failed, attempting in-process Helia fallback:', (httpErr && httpErr.message) || httpErr);
    try {
      const local = await ensureHeliaLocal();
      if (local) return await local.addEvidenceToLocalHelia(content, filename);
    } catch (localErr) {
      console.error('heliaStore: in-process Helia fallback also failed:', (localErr && localErr.message) || localErr);
      // re-throw the original HTTP error for caller to handle
      throw httpErr;
    }
  }
}

export async function getEvidenceFromHelia(cid, heliaApi = DEFAULT_HELIA_API) {
  try {
    if (typeof heliaApi === 'string' && heliaApi.startsWith('inproc')) {
      const local = await ensureHeliaLocal();
      if (local) return await local.getEvidenceFromLocalHelia(cid);
    }
    const resp = await fetch(`${heliaApi.replace(/\/$/, '')}/api/v0/cat?arg=${encodeURIComponent(cid)}`, {
      method: 'POST',
      headers: { 'Accept': '*/*' }
    });
    if (!resp.ok) throw new Error(`Helia cat failed: ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    return text;
  } catch (err) {
    console.error('heliaStore.getEvidenceFromHelia error:', err.message || err);
    throw err;
  }
}

export async function removeEvidenceFromHelia(cid, heliaApi = DEFAULT_HELIA_API) {
  try {
    // If inproc requested, delegate
    if (typeof heliaApi === 'string' && heliaApi.startsWith('inproc')) {
      const local = await ensureHeliaLocal();
      if (local) return await local.removeEvidenceFromLocalHelia(cid);
    }
    // Try to unpin the CID first (best-effort). Some IPFS nodes may not have it pinned.
    const base = heliaApi.replace(/\/$/, '');
    // Attempt pin rm
    try {
      const resp = await fetch(`${base}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`, { method: 'POST' });
      if (resp.ok) {
        // Optionally trigger GC to free space
        try {
          await fetch(`${base}/api/v0/repo/gc`, { method: 'POST' });
        } catch (gcErr) {
          // non-fatal
          console.warn('heliaStore: repo/gc failed (non-fatal):', gcErr.message || gcErr);
        }
        return { removed: true, method: 'pin/rm' };
      }
    } catch (e) {
      // ignore and try block/rm
    }

    // Try block/rm (may fail if CID is part of a DAG or pinned elsewhere)
    try {
      const resp2 = await fetch(`${base}/api/v0/block/rm?arg=${encodeURIComponent(cid)}`, { method: 'POST' });
      if (resp2.ok) return { removed: true, method: 'block/rm' };
    } catch (e2) {
      // ignore
    }

    // If we reach here, we couldn't remove via API; return removed: false
    return { removed: false };
  } catch (err) {
    console.error('heliaStore.removeEvidenceFromHelia error:', err.message || err);
    throw err;
  }
}

export default {
  addEvidenceToHelia,
  getEvidenceFromHelia
};
