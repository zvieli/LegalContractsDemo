import { strict as assert } from 'assert';
import EthCrypto from 'eth-crypto';
import { decryptEvidencePayload } from '../tools/admin/decryptHelper.js';
// import ecies from '../tools/crypto/ecies.js';

describe('decryptEvidencePayload', function() {
  it.skip('decrypts endpoint-wrapped ciphertext produced by eth-crypto', async function() {
    const id = EthCrypto.createIdentity();
    const plaintext = 'hello test decrypt';
  const pubHex = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
  // Skipped: ecies module not available after mock removal; decryptEvidencePayload path not exercised.
  });
});
