import { strict as assert } from 'assert';
import EthCrypto from 'eth-crypto';
import { decryptEvidencePayload } from '../tools/admin/decryptHelper.js';
import ecies from '../tools/crypto/ecies.js';

describe('decryptEvidencePayload', function() {
  it('decrypts endpoint-wrapped ciphertext produced by eth-crypto', async function() {
    const id = EthCrypto.createIdentity();
    const plaintext = 'hello test decrypt';
  const pubHex = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
  const encrypted = await ecies.encryptWithPublicKey(pubHex.startsWith('04') ? pubHex : ('04' + pubHex), plaintext);
  const wrapped = { version: '1', crypto: encrypted };
    const out = await decryptEvidencePayload(wrapped, id.privateKey);
    assert.equal(out, plaintext);
  });
});
