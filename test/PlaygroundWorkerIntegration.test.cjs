const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ethers } = require('ethers');

// Optional integration with live Worker (AI endpoint). If AI_ENDPOINT_URL env not set the tests
// will still pass, skipping the remote invocation section.
// env vars:
//   AI_ENDPOINT_URL  - worker endpoint (maps to secrets.AI_ENDPOINT_URL)
//   AI_KEY  - api key (maps to secrets.AI_API_KEY) (optional if worker allows anon)

const ROOT = path.resolve(path.join(__dirname, '..'));
const AI_ORACLE_PATH = path.join(ROOT, 'chainlink', 'functions', 'ai_oracle.js');
const ARCHETYPES_PATH = path.join(__dirname, 'data', 'nda_archetypes.json');

const AI_ENDPOINT_URL = process.env.AI_ENDPOINT_URL; // e.g. https://nda-ai-endpoint.liorzvieli.workers.dev
const AI_KEY = process.env.AI_KEY;

const PARTY_ADDRESSES = {
  A: '0x00000000000000000000000000000000000000aa',
  B: '0x00000000000000000000000000000000000000bb'
};

function runInline(args, secrets){
  const source = fs.readFileSync(AI_ORACLE_PATH, 'utf8');
  const wrapped = `async function __run(){\n${source}\n}\n__run();`;
  const sandbox = { args, secrets, Functions: { makeHttpRequest: async (cfg) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(()=>controller.abort(), cfg.timeout || 10_000);
      const resp = await fetch(cfg.url, {
        method: cfg.method || 'POST',
        headers: { 'Content-Type':'application/json', ...(cfg.headers||{}) },
        body: cfg.data ? JSON.stringify(cfg.data) : undefined,
        signal: controller.signal
      });
      const text = await resp.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      clearTimeout(id);
      return { data, status: resp.status }; 
    } catch(e){ return { data: null, error: e.message }; }
  }, encodeAbi: (types, values) => ethers.AbiCoder.defaultAbiCoder().encode(types.map(t=>t.type), values) }, console, BigInt, fetch };
  const context = vm.createContext(sandbox);
  const script = new vm.Script(wrapped, { filename: 'ai_oracle.js' });
  return script.runInContext(context);
}

function decode(encoded){
  const d = ethers.AbiCoder.defaultAbiCoder().decode(['bool','uint256','address','address','string','string'], encoded);
  return { approve: d[0], penaltyWei: d[1], beneficiary: d[2], guilty: d[3], classification: d[4], rationale: d[5] };
}

describe('Chainlink Functions AI Worker integration (optional)', function(){
  this.timeout(25_000);
  const archetypes = JSON.parse(fs.readFileSync(ARCHETYPES_PATH,'utf8'));
  const ndaAddress = '0x0000000000000000000000000000000000000011';

  it('environment setup noted', () => {
    // Just a sanity indication in test output
    expect(true).to.equal(true);
  });

  archetypes.forEach((scenario, idx) => {
    it(`Scenario ${idx+1} remote(optional): ${scenario.name}`, async function(){
      const reporter = PARTY_ADDRESSES[scenario.reporter];
      const offender = PARTY_ADDRESSES[scenario.offender];
      const requestedWei = ethers.parseEther(scenario.requestedEth).toString();
      const args = ['11155111', ndaAddress, String(idx), reporter, offender, requestedWei, scenario.evidence];

      // Always run baseline (no secrets)
      const baselineEncoded = await runInline(args, {});
      const base = decode(baselineEncoded);

      // Invariants baseline
      expect(base.penaltyWei).to.be.a('bigint');
      expect(base.penaltyWei).to.lte(BigInt(requestedWei));

      if(!AI_ENDPOINT_URL){
        this.skip(); // mark skipped if no remote endpoint
      }

      const secrets = { AI_ENDPOINT_URL: AI_ENDPOINT_URL, AI_API_KEY: AI_KEY };
      const remoteEncoded = await runInline(args, secrets);
      const remote = decode(remoteEncoded);

      // Generic invariants for remote result (whether overridden or not)
      expect(remote.penaltyWei).to.be.a('bigint');
      expect(remote.penaltyWei).to.lte(BigInt(requestedWei));
      expect(remote.penaltyWei).to.gte(0n);
      expect(remote.beneficiary.toLowerCase()).to.equal(reporter);
      expect(remote.guilty.toLowerCase()).to.equal(offender);
      expect(remote.classification.length).to.be.lte(64);
      expect(remote.rationale.length).to.be.lte(256);

      // If remote differs, log delta (not failing)
      if(remote.penaltyWei.toString() !== base.penaltyWei.toString() || remote.approve !== base.approve){
        console.log(`Scenario ${idx} override: basePenalty=${base.penaltyWei} remotePenalty=${remote.penaltyWei} baseApprove=${base.approve} remoteApprove=${remote.approve}`);
      }
    });
  });
});
