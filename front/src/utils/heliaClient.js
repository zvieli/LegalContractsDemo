import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';

let _heliaPromise = null;
let _fs = null;

export async function getHelia() {
  if (_heliaPromise) return _heliaPromise;
  _heliaPromise = createHelia();
  return _heliaPromise;
}

export async function getUnixFs() {
  if (_fs) return _fs;
  const h = await getHelia();
  _fs = unixfs(h);
  return _fs;
}

export async function addJson(obj) {
  const fs = await getUnixFs();
  const bytes = new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj));
  const cid = await fs.addBytes(bytes);
  return cid.toString();
}

export async function catJson(cid) {
  try {
    const fs = await getUnixFs();
    const decoder = new TextDecoder();
    let data = '';
    for await (const chunk of fs.cat(cid)) {
      data += decoder.decode(chunk, { stream: true });
      if (data.length > 5_000_000) break; // 5MB safety cap
    }
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

// Add raw bytes to Helia and return CID string
export async function addBytesToHelia(bytes) {
  const fs = await getUnixFs();
  const cid = await fs.addBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return cid.toString();
}

// Retrieve raw bytes from Helia by CID, concatenating into a single Uint8Array (capped)
export async function catBytes(cid, maxBytes = 10_000_000) { // 10MB safety cap
  const fs = await getUnixFs();
  const chunks = [];
  let total = 0;
  for await (const chunk of fs.cat(cid)) {
    chunks.push(chunk);
    total += chunk.length;
    if (total > maxBytes) break;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}