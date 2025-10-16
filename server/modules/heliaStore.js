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
  // Always use in-process Helia
  const local = await ensureHeliaLocal();
  if (local) return await local.removeEvidenceFromLocalHelia(cid);
  throw new Error('heliaStore: in-process Helia unavailable');
}

export default {
  addEvidenceToHelia,
  getEvidenceFromHelia
};
