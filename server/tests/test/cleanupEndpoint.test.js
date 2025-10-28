import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import path from 'path';

// Start server on an ephemeral port by setting SERVER_PORT
process.env.SERVER_PORT = process.env.SERVER_PORT || String(40010 + Math.floor(Math.random() * 1000));
process.env.NODE_ENV = 'development';
process.env.ALLOW_DEV_CLEANUP = 'true';

let serverModule = null;
let baseUrl = null;

beforeAll(async () => {
  // Start the server as a child process to avoid ESM interop issues with test runner
  const serverDir = path.resolve(__dirname, '..');
  const env = { ...process.env, NODE_ENV: 'development', ALLOW_DEV_CLEANUP: 'true', SERVER_PORT: process.env.SERVER_PORT };
  const child = spawn(process.execPath, ['index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverModule = child;

  // Capture logs (helpful when tests fail)
  child.stdout.on('data', (d) => console.log('[server stdout]', d.toString().trim()));
  child.stderr.on('data', (d) => console.error('[server stderr]', d.toString().trim()));

  // Wait for server to print the running message
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server failed to start within timeout')), 10000);
    const onData = (chunk) => {
      const s = String(chunk || '');
      if (s.includes('ArbiTrust V7 Server running') || s.includes('Health check:')) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
  });

  const port = process.env.SERVER_PORT;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  // If server was started as child process, kill it
  if (serverModule && typeof serverModule.kill === 'function') {
    serverModule.kill('SIGTERM');
  }
});

describe('/api/dev/cleanup-evidence', () => {
  it('accepts cids array and returns results', async () => {
    // Mock heliaStore.removeEvidenceFromHelia to avoid network operations (Helia only)
  const heliaStore = await import('../../modules/heliaStore.js');
    // ES modules export getters that are read-only; use spyOn to mock behavior
    const spy = vi.spyOn(heliaStore, 'removeEvidenceFromHelia').mockImplementation(async (cid) => ({ removed: true }));

    const res = await fetch(`${baseUrl}/api/dev/cleanup-evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cids: ['bafybeitestcid0000000000000000000000000000000000000', 'bafybeitestcid0000000000000000000000000000000000001'] })
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('results');
  expect(data.results['bafybeitestcid0000000000000000000000000000000000000']).toBeTruthy();

  // restore
  spy.mockRestore();
  });
});
