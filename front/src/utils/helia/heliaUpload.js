// Utility for uploading custom clauses to Helia and returning the CID
// See: https://docs.helia.io/ for API details
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';

export async function uploadCustomClausesToHelia(clauses) {
  const helia = await createHelia();
  const fs = unixfs(helia);
  const data = typeof clauses === 'string' ? clauses : JSON.stringify(clauses);
  const cid = await fs.addBytes(new TextEncoder().encode(data));
  return cid.toString();
}
