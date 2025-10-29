import assert from 'assert';
import { resolveBeneficiary } from '../../modules/llmArbitration.js';

// Simple unit tests for beneficiary resolution
function isZero(addr) { return addr === '0x0000000000000000000000000000000000000000'; }

// Test 1: explicit beneficiary from LLM
const llm1 = { final_verdict: 'PARTY_A_WINS', reimbursement_amount_dai: 0, beneficiary_address: '0x1111111111111111111111111111111111111111' };
const participants1 = { partyA: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', partyB: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
assert.equal(resolveBeneficiary(llm1, participants1), '0x1111111111111111111111111111111111111111', 'Should prefer explicit LLM beneficiary');

// Test 2: PARTY_A_WINS -> partyA
const llm2 = { final_verdict: 'PARTY_A_WINS', reimbursement_amount_dai: 0 };
assert.equal(resolveBeneficiary(llm2, participants1), participants1.partyA, 'PARTY_A_WINS should map to partyA');

// Test 3: PARTY_B_WINS -> partyB
const llm3 = { final_verdict: 'PARTY_B_WINS', reimbursement_amount_dai: 0 };
assert.equal(resolveBeneficiary(llm3, participants1), participants1.partyB, 'PARTY_B_WINS should map to partyB');

// Test 4: DRAW with positive reimbursement -> partyA (claimant)
const llm4 = { final_verdict: 'DRAW', reimbursement_amount_dai: 10 };
assert.equal(resolveBeneficiary(llm4, participants1), participants1.partyA, 'DRAW with reimbursement should map to partyA');

// Test 5: no participants and no beneficiary -> fallback to env or zero address
const llm5 = { final_verdict: 'PARTY_A_WINS', reimbursement_amount_dai: 0 };
const out5 = resolveBeneficiary(llm5, {});
assert.ok(out5, 'Should return a fallback address');

console.log('llmArbitration.beneficiary.test.js passed');
