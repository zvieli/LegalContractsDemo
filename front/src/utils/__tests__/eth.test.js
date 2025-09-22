import { describe, it, expect } from 'vitest';
import { parseEtherSafe, formatEtherSafe } from '../eth';

describe('eth utils', () => {
  it('parseEtherSafe parses decimal ETH strings to wei (BigInt)', () => {
    const wei = parseEtherSafe('1.5');
    expect(typeof wei).toBe('bigint');
    expect(wei).toBe(BigInt('1500000000000000000'));
  });

  it('parseEtherSafe returns 0n for invalid input', () => {
    expect(parseEtherSafe(null)).toBe(0n);
    expect(parseEtherSafe('')).toBe(0n);
    expect(parseEtherSafe('not-a-number')).toBe(0n);
  });

  it('formatEtherSafe formats wei BigInt to ETH string', () => {
    const s = formatEtherSafe(BigInt('2500000000000000000'));
    expect(s).toBe('2.5');
  });

  it('formatEtherSafe handles numeric strings of wei', () => {
    const s = formatEtherSafe('1000000000000000000');
    expect(s).toBe('1.0');
  });
});
