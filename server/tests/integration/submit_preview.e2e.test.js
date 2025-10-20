import { describe, it } from 'mocha';
import assert from 'assert';
import fetch from 'node-fetch';
import fs from 'fs';

const backend = process.env.BACKEND_URL || 'http://localhost:3002';
const deployPath = 'front/src/utils/contracts/deployment-summary.json';

describe('submit-appeal -> preview-evidence integration', function () {
  this.timeout(20000);

  it('submits appeal and previews decrypted content', async function () {
    // quick health checks
    let ds = null;
    try {
      ds = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
    } catch (e) {
      this.skip();
      return;
    }

    const contractAddress = ds.contracts && ds.contracts.EnhancedRentContract;
    if (!contractAddress) this.skip();

    // Submit appeal
    const submitRes = await fetch(`${backend}/api/submit-appeal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractAddress, userEvidence: 'test-evidence-123' })
    });
    if (!submitRes.ok) {
      const txt = await submitRes.text().catch(()=>null);
      throw new Error('submit-appeal failed: ' + submitRes.status + ' ' + txt);
    }
    const jr = await submitRes.json();
    assert.ok(jr && jr.evidenceRef, 'evidenceRef returned');
    const uri = jr.evidenceRef;
    assert.ok(uri.startsWith('ipfs://') || uri.startsWith('file://') || uri.startsWith('http'), 'uri shape');

    // Preview (admin)
    const adminKey = process.env.ADMIN_PREVIEW_KEY;
    if (!adminKey) this.skip();

    const previewRes = await fetch(`${backend}/api/preview-evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ evidenceRef: uri })
    });
    if (!previewRes.ok) {
      const t = await previewRes.text().catch(()=>null);
      throw new Error('preview-evidence failed: ' + previewRes.status + ' ' + t);
    }
    const pj = await previewRes.json();
    assert.ok(pj && pj.plaintext, 'preview returned plaintext');
    const pt = typeof pj.plaintext === 'string' ? pj.plaintext : JSON.stringify(pj.plaintext);
    assert.ok(pt.includes(contractAddress) || pt.includes('test-evidence-123'), 'plaintext contains expected content');
  });
});
