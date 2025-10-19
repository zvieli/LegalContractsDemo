/* eslint-env jest */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContractService } from '../contractService';

// Simple in-memory sessionStorage mock
function createSessionStorageMock() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; }
  };
}

describe('ContractService pending evidence queue', () => {
  let originalWindow;
  let originalFetch;

  beforeEach(() => {
    // Provide minimal window.sessionStorage used by ContractService
    originalWindow = global.window;
    global.window = { sessionStorage: createSessionStorageMock() };
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.window = originalWindow;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('enqueuePendingEvidence and getPendingEvidenceCount / getPendingEvidenceQueue', () => {
    const svc = new ContractService(null, null, 31337);
    const id = svc.enqueuePendingEvidence({ payload: 'hello', digest: '0xabc', endpoint: 'http://127.0.0.1/submit-evidence', ciphertext: '{}' , createdAt: Date.now() });
    expect(typeof id).toBe('string');
    expect(svc.getPendingEvidenceCount()).toBe(1);
    const q = svc.getPendingEvidenceQueue();
    expect(Array.isArray(q)).toBe(true);
    expect(q[0].digest).toBe('0xabc');
  });

  test('retryPendingEvidence removes item on successful POST', async () => {
    const svc = new ContractService(null, null, 31337);
    const id = svc.enqueuePendingEvidence({ payload: 'hello2', digest: '0xdef', endpoint: 'http://127.0.0.1/submit-evidence', ciphertext: '{}' , createdAt: Date.now() });
    // Mock fetch to succeed
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ heliaCid: 'cid:1' }) });
    const ret = await svc.retryPendingEvidence(id);
    expect(svc.getPendingEvidenceCount()).toBe(0);
  });

  test('background uploader records lastError on failure', async () => {
    const svc = new ContractService(null, null, 31337);
    const id = svc.enqueuePendingEvidence({ payload: 'x', digest: '0xdead', endpoint: 'http://127.0.0.1/submit-evidence', ciphertext: '{}' , createdAt: Date.now() });
    // Mock fetch to return non-ok response
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'server oops' });
    // Run background uploader directly
    await svc._backgroundUploader();
    const q = svc.getPendingEvidenceQueue();
    expect(q.length).toBe(1);
    expect(q[0].lastError).toMatch(/server 500/);
    expect(q[0].attempts).toBeGreaterThanOrEqual(1);
  });
});
