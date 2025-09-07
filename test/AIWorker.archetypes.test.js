import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// Runs all NDA archetype scenarios through the Worker module (direct invocation)
// and validates classification, factor-derived penalty, and approval logic.

const archetypesPath = path.join(process.cwd(), 'test', 'data', 'nda_archetypes.json');
const scenarios = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));

function computeExpected(s) {
  const requestedEth = parseFloat(s.requestedEth);
  const evidence = s.evidence.toLowerCase();
  // Base factor tiers
  let factor = 0;
  if (requestedEth < 0.01) factor = 0; else if (requestedEth <= 0.1) factor = 60; else if (requestedEth <= 0.3) factor = 70; else if (requestedEth <= 0.5) factor = 80; else factor = 90;
  const bumpKeywords = ['source','code','gist','roadmap','customer','earnings'];
  const minorKeywords = ['investor','pitch'];
  for (const k of bumpKeywords) if (evidence.includes(k)) factor += 5;
  for (const k of minorKeywords) if (evidence.includes(k)) factor += 2;
  // Category weight (same as Worker)
  const CATEGORY_RULES = [
    { key: 'source_code', keywords: ['source','code','gist'], weight: 15 },
    { key: 'financial_forecast', keywords: ['earnings','guidance','forecast'], weight: 12 },
    { key: 'customer_data', keywords: ['customer','customers','client','clientlist','customerlist'], weight: 10 },
    { key: 'roadmap', keywords: ['roadmap','timeline','releaseplan','milestone'], weight: 8 },
    { key: 'investor_material', keywords: ['investor','pitch','deck'], weight: 6 },
  ];
  let classification = 'generic';
  let catWeight = 0;
  for (const r of CATEGORY_RULES) {
    for (const kw of r.keywords) {
      if (evidence.includes(kw)) { if (r.weight > catWeight) { catWeight = r.weight; classification = r.key; } break; }
    }
  }
  factor += catWeight;
  if (factor > 95) factor = 95;
  const requestedWei = BigInt(Math.round(requestedEth * 1e18));
  let penaltyWei = 0n;
  if (factor > 0) penaltyWei = (requestedWei * BigInt(factor)) / 100n;
  if (penaltyWei > requestedWei) penaltyWei = requestedWei;
  const approve = factor >= 60 && penaltyWei > 0n;
  return { factor, classification, penaltyWei: penaltyWei.toString(), approve, requestedWei: requestedWei.toString() };
}

describe('AI Worker Archetypes Batch (direct)', () => {
  let worker;
  before(async () => {
    const mod = await import(pathToFileURL(path.join(process.cwd(), 'server', 'src', 'index.js')).href);
    worker = mod.default;
  });

  for (const sc of scenarios) {
    it(`evaluates: ${sc.name}`, async () => {
      const expected = computeExpected(sc);
      const body = {
        reporter: '0x1111111111111111111111111111111111111111',
        offender: '0x2222222222222222222222222222222222222222',
        requestedPenaltyWei: expected.requestedWei,
        evidenceText: sc.evidence,
        evidenceHash: sc.evidence
      };
      const req = new Request('https://example.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const resp = await worker.fetch(req, {});
      expect(resp.status).to.equal(200);
      const json = await resp.json();
      // Basic shape
      for (const k of ['approve','penaltyWei','beneficiary','guilty','classification','rationale']) {
        expect(json).to.have.property(k);
      }
      expect(json.classification).to.equal(expected.classification);
      expect(json.penaltyWei).to.equal(expected.penaltyWei);
      expect(json.approve).to.equal(expected.approve);
      if (expected.factor === 0) {
        expect(json.approve).to.equal(false);
      }
      // Rationale should contain category key
      if (expected.classification !== 'generic') {
        expect(json.rationale).to.include(`cat=${expected.classification}`);
      }
    });
  }
});
