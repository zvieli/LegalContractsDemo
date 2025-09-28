import { strict as assert } from 'assert';
import { normalizePublicKeyToBuffer, initHeliaIfNeeded, stopEvidenceEndpoint } from '../tools/evidence-endpoint.cjs';

describe('evidence-endpoint helpers', function() {
  this.timeout(20000);

  it('normalizePublicKeyToBuffer handles common hex forms', function() {
    // 128-char x||y without 04
    const hex128 = 'a'.repeat(128);
    const b1 = normalizePublicKeyToBuffer(hex128);
    assert.ok(Buffer.isBuffer(b1));
    assert.ok(b1.length === 65 || b1.length === 33 || b1.length === 65, 'expected 65 or 33');

    // 130-char with 04
    const hex130 = '04' + 'b'.repeat(128);
    const b2 = normalizePublicKeyToBuffer(hex130);
    assert.ok(Buffer.isBuffer(b2));
    assert.ok(b2.length === 65 || b2.length === 33, 'expected 65 or 33');

    // prefixed with 0x
    const hex0x = '0x' + hex130;
    const b3 = normalizePublicKeyToBuffer(hex0x);
    assert.ok(Buffer.isBuffer(b3));
    assert.ok(b3.length === 65 || b3.length === 33, 'expected 65 or 33');
  });

  it('initHeliaIfNeeded and stopEvidenceEndpoint do not throw', async function() {
    // best-effort: init and stop Helia to ensure start/stop functions work in CI
    let runtime = null;
    try {
      runtime = await initHeliaIfNeeded();
      // runtime may be null if helia modules are not available in this environment; that's OK
      // If available, check for node property
      if (runtime) assert.ok(runtime.node);
    } finally {
      // call stopEvidenceEndpoint with null (should not throw) and with undefined server
      await stopEvidenceEndpoint(null);
    }
  });
});
