import { expect } from 'chai';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

// Simple smoke test for the deployed AI arbitration Worker.
// It is SAFE to run repeatedly; if env vars are missing the test is skipped.
// Set in .env: AI_ENDPOINT_URL=...  (and optionally AI_API_KEY=... if the Worker enforces auth)
// Run: npx hardhat test test/AiWorker.test.js

describe('AI Arbitration Worker (external)', function () {
  const endpoint = process.env.AI_ENDPOINT_URL;
  const apiKey = process.env.AI_API_KEY; // optional – only used if Worker was configured with secret

  if (!endpoint) {
    it('skipped (no AI_ENDPOINT_URL provided)', function () {
      this.skip();
    });
    return; // do not register further tests
  }

  it('returns structured JSON decision', async function () {
    // Basic payload (matches Worker expected fields)
    const body = {
      reporter: '0x1111111111111111111111111111111111111111',
      offender: '0x2222222222222222222222222222222222222222',
      requestedPenaltyWei: (5n * 10n ** 17n).toString(), // 0.5 ETH
      evidenceHash: '0xai_test_case',
      evidenceText: 'source code roadmap customer data snippet'
    };

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    // If unauthorized and we supplied no key, mark skip to avoid failing default test runs.
    if (res.status === 401) {
      if (!apiKey) {
        this.skip();
        return;
      }
    }

    expect(res.status).to.equal(200, `Unexpected status ${res.status}`);
    const json = await res.json();

    // Shape assertions (lenient – just ensuring core contract expectations)
    expect(json).to.be.an('object');
    expect(json).to.have.property('approve');
    expect(typeof json.approve).to.be.oneOf(['boolean']);
    expect(json).to.have.property('penaltyWei');
    expect(json.penaltyWei).to.match(/^\d+$/);
    expect(json).to.have.property('beneficiary');
    expect(json.beneficiary).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(json).to.have.property('guilty');
    expect(json.guilty).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(json).to.have.property('classification');
    expect(json.classification).to.be.a('string');
    expect(json).to.have.property('rationale');
    expect(json.rationale).to.be.a('string');
  });
});

// ---- Batch snapshot suite (merged from AiWorkerBatch.test.js) ----
function toWeiStr(ethStr){
  if(!ethStr) return '0';
  const [whole, frac=''] = ethStr.split('.');
  const fracPad=(frac+'000000000000000000').slice(0,18);
  return (BigInt(whole||'0')*10n**18n + BigInt(fracPad)).toString();
}

describe('AI Arbitration Worker batch (snapshot)', function(){
  const endpoint = process.env.AI_ENDPOINT_URL;
  const apiKey = process.env.AI_API_KEY; // optional

  if(!endpoint){
    it('skipped (no AI_ENDPOINT_URL)', function(){ this.skip(); });
    return;
  }

  const root = path.resolve(process.cwd());
  const archetypesPath = path.join(root,'test','data','nda_archetypes.json');
  const penaltiesPath = path.join(root,'test','snapshots','ai_penalties.json');

  const archetypes = fs.existsSync(archetypesPath) ? JSON.parse(fs.readFileSync(archetypesPath,'utf8')) : [];
  const penalties = fs.existsSync(penaltiesPath) ? JSON.parse(fs.readFileSync(penaltiesPath,'utf8')) : [];

  it('has snapshot + archetype data', function(){
    expect(archetypes.length, 'No archetypes loaded').to.be.greaterThan(0);
    expect(penalties.length, 'Snapshot/archetype length mismatch').to.equal(archetypes.length);
  });

  penalties.forEach((snap) => {
    it(`matches snapshot: ${snap.name}`, async function(){
      const arch = archetypes.find(a=>a.name===snap.name);
      expect(arch, 'Archetype missing for snapshot').to.exist;
      const body = {
        reporter: '0x1111111111111111111111111111111111111111',
        offender: '0x2222222222222222222222222222222222222222',
        requestedPenaltyWei: toWeiStr(snap.requestedEth),
        evidenceHash: arch.evidence,
        evidenceText: snap.name.toLowerCase()
      };
      const headers = { 'Content-Type':'application/json' };
      if(apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(endpoint, { method:'POST', headers, body: JSON.stringify(body) });
      if(res.status === 401 && !apiKey){ this.skip(); return; }
      expect(res.status).to.equal(200);
      const json = await res.json();
      expect(json).to.have.property('penaltyWei');
      expect(json).to.have.property('approve');
      expect(json).to.have.property('classification');
      expect(json.classification).to.equal(snap.classification);
      expect(!!json.approve).to.equal(!!snap.approve);
      const expected = snap.penaltyWei;
      const got = json.penaltyWei;
      expect(got).to.match(/^\d+$/);
      const req = BigInt(body.requestedPenaltyWei);
      expect(BigInt(got) <= req).to.be.true;
      if(got !== expected){
        const exp = BigInt(expected); const g = BigInt(got);
        const diffPct = exp===0n && g===0n ? 0 : Number((g>exp?g-exp:exp-g) * 10000n / (exp===0n?1n:exp))/100;
        expect(diffPct, `Penalty diff ${diffPct}% too large (got ${got} expected ${expected})`).to.be.at.most(5);
      }
    });
  });
});

// ---- Direct archetype evaluation (derive expectations from names) ----
describe('AI Arbitration Worker archetype evaluation (heuristic expectations)', function(){
  const endpoint = process.env.AI_ENDPOINT_URL;
  const apiKey = process.env.AI_API_KEY;
  if(!endpoint){
    it('skipped (no AI_ENDPOINT_URL)', function(){ this.skip(); });
    return;
  }
  const root = path.resolve(process.cwd());
  const archetypesPath = path.join(root,'test','data','nda_archetypes.json');
  const archetypes = fs.existsSync(archetypesPath) ? JSON.parse(fs.readFileSync(archetypesPath,'utf8')) : [];

  function expectedClassification(name){
    const lower=name.toLowerCase();
    if(lower.includes('source code')||lower.includes('gist')) return 'source_code';
    if(lower.includes('roadmap')||lower.includes('milestone')||lower.includes('timeline')) return 'roadmap';
    if(lower.includes('customer')) return 'customer_data';
    if(lower.includes('earnings')||lower.includes('guidance')||lower.includes('forecast')) return 'financial_forecast';
    if(lower.includes('pitch')||lower.includes('investor')) return 'investor_material';
    return 'generic';
  }

  function expectedApprove(name, ethStr){
    if(expectedClassification(name)==='generic') return false; // minor case expected not approve
    try { if(parseFloat(ethStr) < 0.01) return false; } catch {}
    return true;
  }

  it('archetypes loaded', function(){
    expect(archetypes.length).to.be.greaterThan(0);
  });

  archetypes.forEach(arch => {
    it(`judges archetype: ${arch.name}`, async function(){
      const expClass = expectedClassification(arch.name);
      const expApprove = expectedApprove(arch.name, arch.requestedEth);
      const body = {
        reporter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        offender: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        requestedPenaltyWei: toWeiStr(arch.requestedEth),
        evidenceHash: arch.evidence,
        evidenceText: arch.name.toLowerCase()
      };
      const headers = { 'Content-Type':'application/json' };
      if(apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(endpoint, { method:'POST', headers, body: JSON.stringify(body) });
      if(res.status===401 && !apiKey){ this.skip(); return; }
      expect(res.status).to.equal(200);
      const json = await res.json();
      expect(json).to.have.property('classification');
      expect(json).to.have.property('approve');
      expect(json.classification).to.equal(expClass);
      expect(!!json.approve).to.equal(!!expApprove);
      expect(json).to.have.property('penaltyWei');
      const req = BigInt(body.requestedPenaltyWei);
      const pen = BigInt(json.penaltyWei || '0');
      expect(pen <= req).to.be.true;
      if(!expApprove){
        if(req>0n) expect(Number(pen * 100n / (req===0n?1n:req)) <= 5).to.be.true;
      } else {
        if(['source_code','roadmap','customer_data','financial_forecast'].includes(expClass)) {
          if(req>0n) expect(Number(pen * 100n / req)).to.be.greaterThan(30);
        }
      }
    });
  });
});

