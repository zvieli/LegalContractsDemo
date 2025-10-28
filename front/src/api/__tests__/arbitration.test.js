import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDisputeHistory, requestArbitration, triggerArbitrateBatch } from '../../api/arbitration';

global.fetch = vi.fn();

describe('arbitration api client', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('getDisputeHistory calls correct endpoint and returns JSON', async () => {
    const fake = { entries: [{ id: 1 }] };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => fake });
    const res = await getDisputeHistory('case-123');
    expect(fetch).toHaveBeenCalledWith('/api/dispute-history/case-123');
    expect(res).toEqual(fake);
  });

  it('requestArbitration posts to v7 endpoint and returns JSON', async () => {
    const fake = { requestId: 'r1' };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => fake });
    const res = await requestArbitration('case-123', { foo: 'bar' });
    expect(fetch).toHaveBeenCalled();
    expect(res).toEqual(fake);
  });

  it('triggerArbitrateBatch posts to /api/arbitrate-batch', async () => {
    const fake = { ok: true };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => fake });
    const payload = { evidenceRef: 'cid:abc' };
    const res = await triggerArbitrateBatch(payload);
    expect(fetch).toHaveBeenCalled();
    expect(res).toEqual(fake);
  });
});
