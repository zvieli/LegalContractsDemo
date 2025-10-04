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