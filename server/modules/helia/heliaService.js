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
  const data = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
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
