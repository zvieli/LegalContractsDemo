import { expect } from 'chai';
import { canonicalize, computeContentDigest, computeCidDigest } from './frontShim/evidenceCanonicalShim.js';

describe('Evidence Utilities', function(){
  it('canonicalize + contentDigest stable ordering', () => {
    const a = { b:2, a:1, z:{ y:3, x:[2,1] } };
    const b = { z:{ x:[2,1], y:3 }, a:1, b:2 };
    const ca = canonicalize(a); const cb = canonicalize(b);
    expect(ca).to.equal(cb);
    const da = computeContentDigest(a); const db = computeContentDigest(b);
    expect(da).to.equal(db);
  });

  it('computeCidDigest deterministic', () => {
    const cid = 'bafybeigdyrzt5a';
    const d1 = computeCidDigest(cid); const d2 = computeCidDigest(cid);
    expect(d1).to.equal(d2);
  });
});