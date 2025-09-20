import EthCrypto from 'eth-crypto';

// Simple helper: encrypt a utf8 string for a single recipient public key (hex, 0x...)
export async function encryptForRecipient(publicKeyHex, plainText) {
  // EthCrypto expects an unprefixed public key (without 0x04) in hex. If the
  // provided key starts with 0x04 remove it; EthCrypto will accept the raw key.
  let pk = publicKeyHex || '';
  if (pk.startsWith('0x')) pk = pk.slice(2);
  // If provided a compressed/ethers-style key, EthCrypto can handle it; assume
  // the user provides a standard uncompressed public key.
  const encrypted = await EthCrypto.encryptWithPublicKey(pk, plainText);
  // Return the serialized string that can be posted to the pin-server
  return EthCrypto.cipher.stringify(encrypted);
}

// Decrypt function for debugging (requires private key)
export async function decryptWithPrivateKey(privateKeyHex, cipherTextStr) {
  if (privateKeyHex.startsWith('0x')) privateKeyHex = privateKeyHex.slice(2);
  const obj = EthCrypto.cipher.parse(cipherTextStr);
  const decrypted = await EthCrypto.decryptWithPrivateKey(privateKeyHex, obj);
  return decrypted;
}
