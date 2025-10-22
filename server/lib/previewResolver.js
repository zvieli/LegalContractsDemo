import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import heliaStore from '../modules/heliaStore.js';

// previewResolver.fetchPlaintext(ref) -> returns plaintext string
export async function fetchFromIpfsGateway(cid, gateway) {
  const base = gateway || process.env.IPFS_HOST || process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:5001';
  // normalize
  const url = `${base.replace(/\/$/, '')}/api/v0/cat?arg=${encodeURIComponent(cid)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IPFS gateway fetch failed ${res.status}`);
  return await res.text();
}

export async function fetchPlaintext(ref) {
  // Accept helia://<cid>, ipfs://<cid>, or raw http(s) URL
  if (!ref) return '';
  let plaintext = null;
  try {
    if (ref.startsWith('helia://') || ref.startsWith('ipfs://')) {
      const cid = ref.split('://')[1];
      // Try in-process Helia first (if available)
      try {
        const content = await heliaStore.getEvidenceFromHelia(cid);
        if (content) {
          plaintext = content;
        } else {
          // If Helia local didn't return content, ask our own backend evidence retrieval endpoint
          try {
            const backendUrl = (process.env.BACKEND_URL || `http://localhost:${process.env.SERVER_PORT || 3001}`).replace(/\/$/, '');
            const r = await fetch(`${backendUrl}/api/evidence/retrieve/${encodeURIComponent(cid)}`);
            if (r.ok) {
              const j = await r.json();
              // If route returns structured evidence, stringify; if it returns raw text, use it
              if (j && typeof j === 'object') plaintext = JSON.stringify(j);
              else plaintext = String(await r.text());
            } else {
              plaintext = await fetchFromIpfsGateway(cid);
            }
          } catch (e2) {
            plaintext = await fetchFromIpfsGateway(cid);
          }
        }
      } catch (e) {
        // fallback to HTTP gateway
        try {
          plaintext = await fetchFromIpfsGateway(cid);
        } catch (e3) {
          plaintext = ref;
        }
      }
    } else if (ref.startsWith('http://') || ref.startsWith('https://')) {
      const res = await fetch(ref);
      if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
      plaintext = await res.text();
    } else {
      // treat as raw text or cid
      // try in-process Helia first, then IPFS gateway, else return ref
      try {
        const content = await heliaStore.getEvidenceFromHelia(ref);
        plaintext = content || ref;
      } catch (e) {
        plaintext = await fetchFromIpfsGateway(ref).catch(() => ref);
      }
    }
  } catch (err) {
    // last resort: return the ref itself
    plaintext = ref;
  }

  // optional decryption step if server lib provided
  try {
    const decryptPath = path.join(process.cwd(), 'server', 'lib', 'decrypt.js');
    if (fs.existsSync(decryptPath)) {
      // dynamic import to avoid circular
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dec = await import(`../lib/decrypt.js`);
      if (dec && typeof dec.decryptWithAdminPrivKey === 'function') {
        try {
          const maybe = await dec.decryptWithAdminPrivKey(plaintext);
          return maybe;
        } catch (e) {
          // if decryption fails, return plaintext
          return plaintext;
        }
      }
    }
  } catch (e) {
    // ignore
  }

  return plaintext;
}

export default { fetchPlaintext, fetchFromIpfsGateway };
