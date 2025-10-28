// Normalize CIDs to a deterministic canonical string (CIDv1, base32, lower-case)
// Falls back to a trimmed, URL-decoded string if multiformats parsing is unavailable or fails.
export async function canonicalizeCid(rawCid) {
  if (!rawCid || typeof rawCid !== 'string') return null;
  let cid = String(rawCid).trim();
  try {
    cid = decodeURIComponent(cid);
  } catch (e) {
    // ignore decode errors
  }
  // strip common prefixes
  cid = cid.replace(/^helia:\/\//i, '').replace(/^ipfs:\/\//i, '');
  const ipfsMatch = cid.match(/ipfs\/(.+)$/i);
  if (ipfsMatch) cid = ipfsMatch[1];

  try {
    // Use multiformats to parse and convert to CIDv1 base32 canonical form
    const { CID } = await import('multiformats/cid');
    const { base32 } = await import('multiformats/bases/base32');
    const parsed = CID.parse(cid);
    const v1 = parsed.toV1();
    // toString with base32 encoder ensures canonical lower-case base32
    const canon = v1.toString(base32.encoder);
    return canon;
  } catch (e) {
    // If parsing fails, fall back to a minimal normalization: trim and lower-case
    try {
      return cid.trim();
    } catch (e2) {
      return String(rawCid).trim();
    }
  }
}

export default { canonicalizeCid };
