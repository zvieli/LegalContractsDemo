import fs from 'fs';

const DEFAULT_HELIA_API = process.env.HELIA_LOCAL_API || 'inproc://default';

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
  // Helia add may return newline-separated JSON objects; find first JSON with Hash or CID
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
  // Always use in-process Helia
  const local = await ensureHeliaLocal();
  if (local) return await local.addEvidenceToLocalHelia(content, filename);
  throw new Error('heliaStore: in-process Helia unavailable');
}

export async function getEvidenceFromHelia(cid, heliaApi = DEFAULT_HELIA_API) {
  // Always use in-process Helia
  const local = await ensureHeliaLocal();
  if (local) return await local.getEvidenceFromLocalHelia(cid);
  throw new Error('heliaStore: in-process Helia unavailable');
}

export async function removeEvidenceFromHelia(cid, heliaApi = DEFAULT_HELIA_API) {
  console.log('heliaStore.removeEvidenceFromHelia called with', { cid, heliaApi });
  // If heliaApi is a http(s) endpoint, attempt remote removal via HTTP API
  try {
    if (typeof heliaApi === 'string' && heliaApi.startsWith('http')) {
      console.log('heliaStore: attempting HTTP API removal at', heliaApi);
      // Try a best-effort HTTP removal call. Tests may mock global.fetch to throw.
      try {
        const url = heliaApi.replace(/\/$/, '') + `/api/v0/block/rm?arg=${encodeURIComponent(cid)}`;
        if (typeof global.fetch !== 'function') {
          // Node older runtimes may not have fetch - try to import node-fetch dynamically
          try {
            const nf = await import('node-fetch');
            global.fetch = nf.default || nf;
          } catch (e) {}
        }
        const resp = await global.fetch(url, { method: 'POST' });
        // Treat non-2xx as failure
        if (!resp || typeof resp.status !== 'number' || resp.status < 200 || resp.status >= 300) {
          console.log('heliaStore: HTTP removal returned non-2xx', resp && resp.status);
          return { removed: false, status: resp && resp.status };
        }
        console.log('heliaStore: HTTP removal succeeded', resp.status);
        return { removed: true, status: resp.status };
      } catch (err) {
        console.log('heliaStore: HTTP removal threw', err && err.message ? err.message : err);
        return { removed: false, error: err && err.message ? err.message : String(err) };
      }
    }

    // Fallback: use in-process Helia
    const local = await ensureHeliaLocal();
    if (local) return await local.removeEvidenceFromLocalHelia(cid);
    return { removed: false, error: 'heliaStore: in-process Helia unavailable' };
  } catch (e) {
    return { removed: false, error: e && e.message ? e.message : String(e) };
  }
}

export default {
  addEvidenceToHelia,
  getEvidenceFromHelia
};
