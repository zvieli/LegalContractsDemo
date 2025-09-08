import { expect } from 'chai';
import app from '../server/src/index.js';

describe('Rent AI Baseline Decision', () => {
  it('classifies damage as rent_damage and approves when severity high', async () => {
    const payload = { domain:'RENT', disputeType:'Damage', reporter:'0x1111111111111111111111111111111111111111', offender:'0x2222222222222222222222222222222222222222', requestedPenaltyWei:'0x2386f26fc10000', evidenceText:'Severe structural damage mold and fire'};
    const res = await app.fetch(new Request('http://local', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)}), process.env);
    const out = await res.json();
    expect(out.classification).to.match(/^rent_damage/);
    expect(out.approve).to.equal(true);
  });
  it('denies minor quality cosmetic issue', async () => {
    const payload = { domain:'RENT', disputeType:'Quality', reporter:'0x1111111111111111111111111111111111111111', offender:'0x2222222222222222222222222222222222222222', requestedPenaltyWei:'0x2386f26fc10000', evidenceText:'minor cosmetic paint issue only'};
    const res = await app.fetch(new Request('http://local', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)}), process.env);
    const out = await res.json();
    expect(out.approve).to.equal(false);
  });
});
