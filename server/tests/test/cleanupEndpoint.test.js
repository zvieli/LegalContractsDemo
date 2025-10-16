import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fetch from 'node-fetch';

// Start server on an ephemeral port by setting SERVER_PORT
process.env.SERVER_PORT = process.env.SERVER_PORT || String(40010 + Math.floor(Math.random() * 1000));
process.env.NODE_ENV = 'development';
process.env.ALLOW_DEV_CLEANUP = 'true';

let serverModule = null;
let baseUrl = null;

beforeAll(async () => {
  // import server (it will call app.listen)
  serverModule = await import('../index.js');
  const port = process.env.SERVER_PORT;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  // attempt to close process by killing; server index uses process.exit on shutdown so we can't reliably stop it here.
});

describe('/api/dev/cleanup-evidence', () => {
  it('accepts cids array and returns results', async () => {
    // Mock heliaStore.removeEvidenceFromHelia to avoid network operations (Helia only)
    const heliaStore = await import('../modules/heliaStore.js');
    // ES modules export getters that are read-only; use spyOn to mock behavior
    const spy = vi.spyOn(heliaStore, 'removeEvidenceFromHelia').mockImplementation(async (cid) => ({ removed: true }));

    const res = await fetch(`${baseUrl}/api/dev/cleanup-evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cids: ['QmTestCid1', 'QmTestCid2'] })
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('results');
    expect(data.results['QmTestCid1']).toBeTruthy();

  // restore
  spy.mockRestore();
  });
});
