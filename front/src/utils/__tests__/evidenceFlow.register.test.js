import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runEvidenceFlow } from '../../hooks/useEvidenceFlow';

describe('runEvidenceFlow register-dispute payload', () => {
  const originalFetch = globalThis.fetch;
    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

  it('sends cid and cidHash to /register-dispute when /submit-evidence returns heliaCid and cidHash', async () => {
    const fakeCid = 'bafybeiadummycid1234567890';
    const fakeCidHash = '0x' + 'ab'.repeat(32);
    const fakeDigest = '0x' + '11'.repeat(32);

  // Mock /submit-evidence response
  globalThis.fetch.mockImplementationOnce(async (url, _opts) => {
    void _opts;
      if (String(url).endsWith('/submit-evidence')) {
        return {
          ok: true,
          json: async () => ({ digest: fakeDigest, heliaCid: fakeCid, cid: fakeCid, cidHash: fakeCidHash })
        };
      }
      throw new Error('unexpected first fetch ' + url);
    });

    // Mock transaction returned by submitToContract
    const fakeTx = {
      hash: '0xtxhashdummy',
      wait: async () => ({ status: 1 })
    };

    // Capture the register-dispute body
    let registerBody = null;
    // Next fetch is /register-dispute
      globalThis.fetch.mockImplementationOnce(async (url, _opts) => {
          void _opts;
      if (String(url).endsWith('/register-dispute')) {
        try {
          registerBody = JSON.parse(_opts && _opts.body ? _opts.body : '{}');
        } catch (e) { void e;
          registerBody = null;
        }
        return { ok: true, json: async () => ({ ok: true, id: 'reg1' }) };
      }
      throw new Error('unexpected second fetch ' + url);
    });

    // runEvidenceFlow - pass submitToContract that returns fakeTx
    const prepareEvidencePayloadFn = async (raw) => { void raw; return { digest: fakeDigest, ciphertext: 'hello' }; };
    const result = await runEvidenceFlow(async ({ digest }) => {
      // ensure we receive the helia uri/cid or digest as passed to submitToContract
      expect([fakeCid, `ipfs://${fakeCid}`, fakeDigest]).toContain(digest);
      return fakeTx;
    }, '', { fileOrText: 'hello', reporterAddress: '0xreporter' }, prepareEvidencePayloadFn);

    // result should include digest and cid
    expect(result.digest).toBe(fakeDigest);
    expect(result.cid).toBe(fakeCid);

    // registerBody should have been captured and include cid and cidHash
    expect(registerBody).not.toBeNull();
    expect(registerBody.cid).toBe(fakeCid);
    expect(registerBody.cidHash).toBe(fakeCidHash);
    expect(registerBody.digest).toBe(fakeDigest);
  });

  it('uses heliaUri for on-chain submit and registers cid derived from heliaUri', async () => {
    const fakeCid = 'bafybeiauri1234567890';
    const fakeHeliaUri = `helia://${fakeCid}`;
    const fakeCidHash = '0x' + 'cd'.repeat(32);
    const fakeDigest = '0x' + '22'.repeat(32);

    // Mock /submit-evidence response returning heliaUri
  globalThis.fetch.mockImplementationOnce(async (url, _opts) => {
    void _opts;
    if (String(url).endsWith('/submit-evidence')) {
        return {
          ok: true,
          json: async () => ({ digest: fakeDigest, heliaUri: fakeHeliaUri, cidHash: fakeCidHash })
        };
      }
      throw new Error('unexpected first fetch ' + url);
    });

    // Mock transaction returned by submitToContract
    const fakeTx = { hash: '0xtxhash2', wait: async () => ({ status: 1 }) };

    // Capture the register-dispute body
    let registerBody = null;
  globalThis.fetch.mockImplementationOnce(async (url, _opts) => {
      void _opts;
      if (String(url).endsWith('/submit-evidence')) {
        registerBody = JSON.parse(_opts && _opts.body ? _opts.body : '{}');
        return { ok: true, json: async () => ({ ok: true, id: 'reg2' }) };
      }
      throw new Error('unexpected second fetch ' + url);
    });

  const prepareEvidencePayloadFn = async (raw) => { void raw; return { digest: fakeDigest, ciphertext: 'hello' }; };

    const result = await runEvidenceFlow(async ({ digest }) => {
      // submitToContract should receive the heliaUri string as the digest parameter
      expect(digest).toBe(fakeHeliaUri);
      return fakeTx;
    }, '', { fileOrText: 'hello', reporterAddress: '0xreporter' }, prepareEvidencePayloadFn);

    expect(result.digest).toBe(fakeDigest);
    expect(result.cid).toBe(fakeCid);
    expect(registerBody).not.toBeNull();
    expect(registerBody.cid).toBe(fakeCid);
    expect(registerBody.cidHash).toBe(fakeCidHash);
  });

  it('throws when server digest does not match computed digest (digest_mismatch)', async () => {
    const computedDigest = '0x' + 'aa'.repeat(32);
    const serverDigest = '0x' + 'bb'.repeat(32);

    // Mock /submit-evidence to return a different digest
  globalThis.fetch.mockImplementationOnce(async (url, _opts) => {
      void _opts;
      if (String(url).endsWith('/submit-evidence')) {
        return { ok: true, json: async () => ({ digest: serverDigest }) };
      }
      throw new Error('unexpected fetch ' + url);
    });

  const prepareEvidencePayloadFn = async (raw) => { void raw; return { digest: computedDigest, ciphertext: 'hello' }; };

    await expect(runEvidenceFlow(async () => ({ hash: '0x1' }), '', { fileOrText: 'x' }, prepareEvidencePayloadFn)).rejects.toThrow(/digest_mismatch/);
  });
});
