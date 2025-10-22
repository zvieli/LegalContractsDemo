import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import DisputeForwarder from '../disputeForwarder.js';

describe('DisputeForwarder basic flow', () => {
  it('processes enqueued job and writes verdict', async () => {
    const tmpData = path.join(process.cwd(), 'server', 'data', 'test-forwarder');
    if (!fs.existsSync(tmpData)) fs.mkdirSync(tmpData, { recursive: true });
    const verdictFile = path.join(tmpData, 'llm-verdicts.json');
    if (fs.existsSync(verdictFile)) fs.unlinkSync(verdictFile);

    const previewResolver = {
      fetchPlaintext: async (ref) => `PLAINTEXT_FOR:${ref}`
    };

    const llmClient = {
      callLLM: async ({ input }) => ({ ok: true, model: 'mock', raw: { result: 'ok' }, verdict: `VERDICT:${input.slice(0,20)}` })
    };

    const forwarder = new DisputeForwarder({ llmClient, previewResolver, dataPath: tmpData });

    const job = forwarder.enqueueJob({ evidenceRef: 'helia://cid123', caseId: 'CASE1', contractAddress: '0xabc' });

    // wait a small bit for worker to process
    await new Promise((r) => setTimeout(r, 500));

    expect(fs.existsSync(verdictFile)).toBe(true);
    const arr = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
    expect(arr.length).toBeGreaterThan(0);
    const record = arr.find((x) => x.jobId === job.jobId);
    expect(record).toBeTruthy();
    expect(record.evidenceRef).toBe('helia://cid123');
  });
});
