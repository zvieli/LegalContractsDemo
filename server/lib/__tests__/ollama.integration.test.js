import { describe, it, expect } from 'vitest';
import fetch from 'node-fetch';
import LLMClient from '../llmClient.js';

describe('Ollama integration (requires local Ollama)', () => {
  it('calls the configured Ollama model if reachable', async () => {
    const base = process.env.OLLAMA_HOST || process.env.LLM_ARBITRATOR_URL;
    if (!base) {
      console.warn('OLLAMA_HOST not configured; skipping Ollama integration test');
      return;
    }

    // quick probe
    try {
      const probe = await fetch(base.replace(/\/$/, '') + '/api/version', { method: 'GET', timeout: 2000 });
      if (!probe.ok) {
        console.warn('Ollama probe failed, skipping Ollama integration test');
        return;
      }
    } catch (e) {
      console.warn('Ollama not reachable; skipping Ollama integration test', e.message || e);
      return;
    }

    const client = new LLMClient({});
    const res = await client.callLLM({ input: 'Hello Ollama test', options: {} });
    expect(res.ok).toBe(true);
    expect(res.raw).toBeTruthy();
  }, 20000);
});
