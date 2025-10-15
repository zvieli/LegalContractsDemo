// Utility for uploading custom clauses to IPFS/Helia and returning the hash
import { addJson } from './heliaClient';

export async function uploadCustomClausesToIPFS(clauses) {
  if (!clauses || typeof clauses !== 'string' || clauses.trim() === '') return null;
  try {
    const cid = await addJson({ customClauses: clauses });
    // Return digest as bytes32 (first 32 bytes of CID hash, or full CID string)
    return cid.toString();
  } catch (e) {
    console.error('Failed to upload custom clauses to IPFS:', e);
    return null;
  }
}
