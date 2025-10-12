import { describe, it, expect, vi } from 'vitest';
import * as heliaStore from '../modules/heliaStore.js';

describe('heliaStore.removeEvidenceFromHelia (unit)', () => {
  it('should return removed false when API unreachable', async () => {
    // Mock global fetch to throw
    const origFetch = global.fetch;
    global.fetch = vi.fn(() => { throw new Error('network'); });
    try {
      const res = await heliaStore.removeEvidenceFromHelia('QmDummyCid', 'http://127.0.0.1:59999');
      expect(res).toHaveProperty('removed', false);
    } finally {
      global.fetch = origFetch;
    }
  });
});
