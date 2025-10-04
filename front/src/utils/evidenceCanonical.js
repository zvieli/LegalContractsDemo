import { keccak256, toUtf8Bytes } from 'ethers';

// Deterministic key ordering + JSON stringify without whitespace differences
export function canonicalize(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(e => canonicalize(e)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const parts = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

export function computeContentDigest(obj) {
  const canon = typeof obj === 'string' ? obj : canonicalize(obj);
  return keccak256(toUtf8Bytes(canon));
}

export function computeCidDigest(cid) {
  return keccak256(toUtf8Bytes(String(cid || '')));
}

export function attachDigests(evidence) {
  const cloned = { ...evidence };
  cloned.contentDigest = computeContentDigest(evidence);
  if (evidence.cid && !evidence.cidDigest) {
    cloned.cidDigest = computeCidDigest(evidence.cid);
  }
  return cloned;
}
