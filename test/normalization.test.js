import assert from 'assert';
import { canonicalizeAddress, normalizePubForEthCrypto } from '../tools/evidence-endpoint.js';

describe('Normalization helpers', function() {
  it('normalize public key with and without 04 prefix', function() {
    const rawXY = 'a'.repeat(128);
    const with04 = normalizePubForEthCrypto('04' + rawXY);
    const without04 = normalizePubForEthCrypto(rawXY);
    assert.strictEqual(with04, without04);
    assert.strictEqual(with04.startsWith('04'), true);
    assert.strictEqual(with04, with04.toLowerCase());
  });

  it('normalize public key with 0x prefix', function() {
    const raw = '0x' + 'b'.repeat(128);
    const norm = normalizePubForEthCrypto(raw);
    assert.strictEqual(norm, ('04' + 'b'.repeat(128)).toLowerCase());
  });

  it('canonicalize address variations', function() {
    const a = '0xAbC1230000000000000000000000000000000000';
    const b = 'abc1230000000000000000000000000000000000'; // no 0x
    const c = '0x' + b;
    const expected = '0xabc1230000000000000000000000000000000000';
    assert.strictEqual(canonicalizeAddress(a), expected);
    const bCanon = canonicalizeAddress(b);
    assert.strictEqual(bCanon, expected); // now always 0x-prefixed
    assert.strictEqual(canonicalizeAddress(c), expected);
    // malformed inputs
    assert.strictEqual(canonicalizeAddress(''), null);
    assert.strictEqual(canonicalizeAddress('0xZZZ'), null);
  });
});
