import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
// Mock the contract instance used by contractService so reportDispute doesn't throw in tests
vi.mock('../contractInstance.js', () => {
  return {
    contract: {
      reportDispute: async (id, digest, overrides) => {
        return { receipt: { logs: [] }, caseId: '42' };
      }
    }
  };
});
import * as evidenceModule from '../../utils/evidence.js';
import { submitEvidenceAndReport } from '../contractService.js';

describe('submitEvidenceAndReport retry flow', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('re-encrypts when server returns 400 with adminPublicKey and retries', async () => {
    // mock prepareEvidencePayload to return ciphertext for initial encrypt
    const fakeCiphertext = JSON.stringify({ version: '1', crypto: { ciphertext: 'aa' } });
    const fakeDigest = '0xabc0000000000000000000000000000000000000000000000000000000000000';
    vi.spyOn(evidenceModule, 'prepareEvidencePayload').mockImplementation(async (payload, opts) => {
      // if opts.encryptToAdminPubKey provided, return new ciphertext and digest
      if (opts && opts.encryptToAdminPubKey) {
        return { ciphertext: JSON.stringify({ version: '1', crypto: { ciphertext: 're-'+opts.encryptToAdminPubKey } }), digest: fakeDigest };
      }
      return { digest: fakeDigest };
    });

    // mock fetch: first call returns 400 w/ adminPublicKey, second returns 200 with digest
    let call = 0;
    global.fetch = vi.fn(async (url, options) => {
      call++;
      if (call === 1) {
        return { ok: false, status: 400, json: async () => ({ error: 'ciphertext wrapper not encrypted for this admin key', adminPublicKey: '0x04deadbeef' }), text: async () => JSON.stringify({ error: 'ciphertext wrapper' }) };
      }
      // second call
      return { ok: true, status: 200, json: async () => ({ digest: '0xdead000000000000000000000000000000000000000000000000000000000000' }), text: async () => '' };
    });

    // call submitEvidenceAndReport directly (it will call prepareEvidencePayload which we mocked)
    const returnedDigest = await submitEvidenceAndReport('dummyId', 'somedata', {});
    expect(returnedDigest).toBe('0xdead000000000000000000000000000000000000000000000000000000000000');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
