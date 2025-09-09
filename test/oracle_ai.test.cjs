const chai = require('chai');
const expect = chai.expect;
let requestAIDecision;
before(async () => {
  const mod = await import('../front/src/services/aiService.js');
  requestAIDecision = mod.requestAIDecision;
});
const ndaCases = require('./data/nda_cases_normalized.json');
const rentCases = require('./data/rent_disputes.json');

describe('Oracle AI Response Format & Logic', () => {
  ndaCases.forEach((ndaCase) => {
  it(`NDA Case ${ndaCase.caseId} - response format is valid`, async () => {
  const res = await requestAIDecision(ndaCase);
  expect(res).to.have.property('caseId', ndaCase.caseId);
  expect(res).to.have.property('status');
  expect(res).to.have.property('awardedWei');
  expect(res).to.have.property('decision');
  expect(res).to.have.property('rationale');
  expect(res).to.have.property('resolvedAt');
    });
  it(`NDA Case ${ndaCase.caseId} - decision logic`, async () => {
  const res = await requestAIDecision(ndaCase);
  expect(['resolved', 'rejected', 'pending']).to.include(res.status);
  expect(res.awardedWei).to.be.at.least(0);
  expect(res.decision).to.be.a('string');
  expect(res.rationale).to.be.a('string');
    });
  });

  rentCases.forEach((rentCase) => {
  it(`Rent Case ${rentCase.caseId} - response format is valid`, async () => {
  const res = await requestAIDecision(rentCase);
  expect(res).to.have.property('caseId', rentCase.caseId);
  expect(res).to.have.property('status');
  expect(res).to.have.property('awardedWei');
  expect(res).to.have.property('decision');
  expect(res).to.have.property('rationale');
  expect(res).to.have.property('resolvedAt');
    });
  it(`Rent Case ${rentCase.caseId} - decision logic`, async () => {
  const res = await requestAIDecision(rentCase);
  expect(['resolved', 'rejected', 'pending']).to.include(res.status);
  expect(res.awardedWei).to.be.at.least(0);
  expect(res.decision).to.be.a('string');
  expect(res.rationale).to.be.a('string');
    });
  });
});
