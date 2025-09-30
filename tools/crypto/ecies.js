import EthCrypto from 'eth-crypto';

function normalizePub(pub) {
  if (!pub) throw new Error('public key required');
  let s = String(pub).trim();
  if (s.startsWith('0x')) s = s.slice(2);
  if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
  return s;
}

function normalizePriv(priv) {
  if (!priv) throw new Error('private key required');
  let s = String(priv).trim();
  if (s.startsWith('0x')) s = s.slice(2);
  return s;
}

export async function encryptWithPublicKey(pubkeyHex, plaintext) {
  const pub = normalizePub(pubkeyHex);
  // EthCrypto expects '0x04...' or '04...' — pass without 0x is fine
  const enc = await EthCrypto.encryptWithPublicKey(pub, plaintext);
  // Normalize to strings
  return {
    iv: enc.iv ? String(enc.iv) : null,
    ephemPublicKey: enc.ephemPublicKey ? String(enc.ephemPublicKey) : null,
    ciphertext: enc.ciphertext ? String(enc.ciphertext) : null,
    mac: enc.mac ? String(enc.mac) : null
  };
}

export async function decryptWithPrivateKey(privkeyHex, encrypted) {
  const priv = normalizePriv(privkeyHex);
  // Pass through to eth-crypto and return the plaintext string or throw
  return await EthCrypto.decryptWithPrivateKey(priv, encrypted);
}

export default { encryptWithPublicKey, decryptWithPrivateKey };
