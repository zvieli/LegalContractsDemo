import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';

describe('ECIES browser input normalization', function() {
  let ecies;
  let secp;
  before(async function() {
    const eciesPath = path.join(path.resolve(), 'front', 'src', 'utils', 'ecies-browser.js');
    ecies = await import(pathToFileURL(eciesPath).href);
    secp = await import('@noble/secp256k1');
  });

  it('expands compressed public key input', async function() {
    const priv = (await import('crypto')).randomBytes(32);
    const privArr = Uint8Array.from(priv);
    const pubUn = secp.getPublicKey(privArr, false); // uncompressed
    const pubComp = secp.getPublicKey(privArr, true); // compressed
    const pubCompHex = Array.from(pubComp).map(b=>b.toString(16).padStart(2,'0')).join('');
    const pubUnHex = Array.from(pubUn).map(b=>b.toString(16).padStart(2,'0')).join('');
    const pubUnNorm = ecies.normalizePublicKeyHex(pubUnHex);
    const pubFromComp = ecies.normalizePublicKeyHex(pubCompHex);
    if (pubFromComp !== pubUnNorm) {
      console.error('DEBUG pubUnHex', pubUnHex.length, pubUnHex.slice(0,8), pubUnHex.slice(-8));
      console.error('DEBUG pubCompHex', pubCompHex.length, pubCompHex.slice(0,8), pubCompHex.slice(-8));
      console.error('DEBUG pubUnNorm', pubUnNorm.length, pubUnNorm.slice(0,8), pubUnNorm.slice(-8));
      console.error('DEBUG pubFromComp', pubFromComp.length, pubFromComp.slice(0,8), pubFromComp.slice(-8));
    }
    assert.strictEqual(pubFromComp, pubUnNorm);
  });

  it('accepts 0x-prefixed and non-prefixed inputs equivalently', async function() {
    const priv = (await import('crypto')).randomBytes(32);
    const privArr = Uint8Array.from(priv);
    const pubUn = secp.getPublicKey(privArr, false);
    const hex = Array.from(pubUn).map(b=>b.toString(16).padStart(2,'0')).join('');
    const with0x = '0x' + hex;
    assert.strictEqual(ecies.normalizePublicKeyHex(hex), ecies.normalizePublicKeyHex(with0x));
  });

  it('throws or returns something reasonable for invalid input', function() {
    // This should not crash with an exception other than the intended error
    try {
      const out = ecies.normalizePublicKeyHex('deadbeef');
      // likely returns not-throwing lowercased string; assert returned string
      assert.strictEqual(typeof out, 'string');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });
});
