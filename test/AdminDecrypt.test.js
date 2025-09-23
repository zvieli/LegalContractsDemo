import { expect } from 'chai';
import EthCrypto from 'eth-crypto';
import { decryptEvidencePayload } from '../tools/admin/decryptHelper.js';

describe('Admin decrypt helper roundtrip', function () {
  it('encrypts with public key and decrypts with private key', async function () {
    // generate identity
    const identity = EthCrypto.createIdentity();
    const msg = 'Secret evidence payload';
    // EthCrypto.encryptWithPublicKey expects a public key without 0x04 prefix
    const rawPub = identity.publicKey.startsWith('0x') ? identity.publicKey.slice(2) : identity.publicKey;
    const pub = rawPub.startsWith('04') ? rawPub.slice(2) : rawPub;
    const encrypted = await EthCrypto.encryptWithPublicKey(pub, msg);
    const payloadStr = JSON.stringify(encrypted);
  const decrypted = await decryptEvidencePayload(payloadStr, identity.privateKey);
  expect(decrypted).to.equal(msg);
  });
});
