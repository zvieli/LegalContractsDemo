// Helia service for adding/getting evidence
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';

let heliaInstance = null;
let fs = null;

export async function getHelia() {
  if (!heliaInstance) {
    heliaInstance = await createHelia();
    fs = unixfs(heliaInstance);
  }
  return { helia: heliaInstance, fs };
}

export async function addEvidenceToHelia(evidence, filename = 'evidence.json') {
  const { fs } = await getHelia();
  // Accept string, object, Buffer, or Uint8Array
  if (typeof evidence === 'string') {
    const cid = await fs.addBytes(new TextEncoder().encode(evidence));
    return { cid: cid.toString(), size: evidence.length };
  }
  if (evidence instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(evidence))) {
    // add raw bytes
    const bytes = evidence instanceof Uint8Array ? evidence : new Uint8Array(evidence);
    const cid = await fs.addBytes(bytes);
    return { cid: cid.toString(), size: bytes.length };
  }
  // fallback: JSON stringify objects
  const data = typeof evidence === 'object' ? JSON.stringify(evidence) : String(evidence);
  const cid = await fs.addBytes(new TextEncoder().encode(data));
  return { cid: cid.toString(), size: data.length };
}

export async function getEvidenceFromHelia(cid) {
  const { fs } = await getHelia();
  let content = '';
  for await (const chunk of fs.cat(cid)) {
    content += new TextDecoder().decode(chunk);
  }
  return content;
}
