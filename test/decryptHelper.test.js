import { strict as assert } from 'assert';
import EthCrypto from 'eth-crypto';
import { decryptEvidencePayload } from '../tools/admin/decryptHelper.js';

describe('decryptEvidencePayload', function() {
  it('decrypts endpoint-wrapped ciphertext produced by eth-crypto', async function() {
    const id = EthCrypto.createIdentity();
    const plaintext = 'hello test decrypt';
    const encrypted = await EthCrypto.encryptWithPublicKey(id.publicKey, plaintext);
    const wrapped = { version: '1', crypto: encrypted };
    const out = await decryptEvidencePayload(wrapped, id.privateKey);
    assert.equal(out, plaintext);
  });
});
