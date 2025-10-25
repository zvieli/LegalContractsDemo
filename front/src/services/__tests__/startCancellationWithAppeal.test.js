/* global global */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// localStorage polyfill for Node test environment
if (typeof localStorage === 'undefined' || localStorage === null) {
  global.localStorage = (function () {
    let store = {};
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
      clear() {
        store = {};
      },
    };
  })();
}
import { ContractService } from '../contractService';

describe('ContractService.startCancellationWithAppeal', () => {
  let svc;
  beforeEach(() => {
    svc = new ContractService(null, null, { provider: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { localStorage.removeItem('appealEvidence:0xabc'); } catch (e) { void e;}
  });

  it('uploads evidence and initiates cancellation when none requested', async () => {
    const mockedRef = 'helia://cid123';
  // Mock fetch to server submit-appeal endpoint
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ evidenceRef: mockedRef }) });
    vi.spyOn(svc, 'getEnhancedRentContractForWrite').mockResolvedValue({ cancelRequested: async () => false });
    const initSpy = vi.spyOn(svc, 'initiateCancellation').mockResolvedValue({ hash: '0x1' });

  await svc.startCancellationWithAppeal('0xabc', { appealEvidence: 'some evidence', feeValueEth: '0.01' });
    expect(initSpy).toHaveBeenCalledWith('0xabc');
    // persisted mapping should exist
  const raw = localStorage.getItem('appealEvidence:0xabc');
    expect(raw).toBeTruthy();
    const arr = JSON.parse(raw);
    expect(Array.isArray(arr)).toBe(true);
  // Accept either a helia:// (or ipfs://) manifest URI or a hex digest (0x...)
  expect(typeof arr[0].ref).toBe('string');
  expect(arr[0].ref).toMatch(/^(helia:\/\/|ipfs:\/\/|0x)/);
  });

  it('continues when upload fails and still initiates cancellation', async () => {
    // Simulate server failure
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'fail' });
    vi.spyOn(svc, 'getEnhancedRentContractForWrite').mockResolvedValue({ cancelRequested: async () => false });
    const initSpy = vi.spyOn(svc, 'initiateCancellation').mockResolvedValue({ hash: '0x2' });

  await svc.startCancellationWithAppeal('0xabc', { appealEvidence: 'fail evidence' });
    expect(initSpy).toHaveBeenCalledWith('0xabc');
    // no mapping should be stored when upload fails
    const raw = localStorage.getItem('appealEvidence:0xabc');
    expect(raw).toBeNull();
  });

  it('approves cancellation if cancelRequested is already true', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ evidenceRef: '0xdeadbeef' }) });
    vi.spyOn(svc, 'getEnhancedRentContractForWrite').mockResolvedValue({ cancelRequested: async () => true });
    const approveSpy = vi.spyOn(svc, 'approveCancellation').mockResolvedValue({ hash: '0x3' });

  await svc.startCancellationWithAppeal('0xabc', { appealEvidence: 'any' });
    expect(approveSpy).toHaveBeenCalledWith('0xabc');
    const raw = localStorage.getItem('appealEvidence:0xabc');
    expect(raw).toBeTruthy();
    const arr = JSON.parse(raw);
    expect(typeof arr[0].ref).toBe('string');
    expect(arr[0].ref).toMatch(/^(helia:\/\/|ipfs:\/\/|0x)/);
  });
});
