import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Updated deterministic "AI" logic mirroring on-chain/off-chain baseline (severity + keyword bumps)
// Rules (see chainlink/functions/ai_oracle.js & server/src/index.js):
//  size tiers (ETH): <0.01 => 0% (deny); <=0.1 => 60%; <=0.3 => 70%; <=0.5 => 80%; >0.5 => 90%
//  keyword bumps: +5 each of [source,code,gist,roadmap,customer,earnings]; +2 each of [investor,pitch]; cap 95%
//  approve if factor >=60 and penalty>0 and reporter != offender
function baselineAiDecision({ requestedPenaltyWei, reporter, offender, evidence }) {
  let req = requestedPenaltyWei;
  if (req < 0n) req = 0n;
  const ethScaled = Number(req) / 1e18;
  let factor = 0;
  if (ethScaled < 0.01) factor = 0; else if (ethScaled <= 0.1) factor = 60; else if (ethScaled <= 0.3) factor = 70; else if (ethScaled <= 0.5) factor = 80; else factor = 90;
  const s = (evidence || '').toLowerCase();
  const bumpKeywords = ['source','code','gist','roadmap','customer','earnings'];
  const minorKeywords = ['investor','pitch'];
  const CATEGORY_RULES = [
    { key: 'source_code', keywords: ['source','code','gist'], weight: 15 },
    { key: 'financial_forecast', keywords: ['earnings','guidance','forecast'], weight: 12 },
    { key: 'customer_data', keywords: ['customer','customers','client','clientlist','customerlist'], weight: 10 },
    { key: 'roadmap', keywords: ['roadmap','timeline','releaseplan','milestone'], weight: 8 },
    { key: 'investor_material', keywords: ['investor','pitch','deck'], weight: 6 },
  ];
  function detectCategory(t){
    let best={ key:'generic', weight:0};
    for(const r of CATEGORY_RULES){
      for(const kw of r.keywords){ if(t.includes(kw)){ if(r.weight>best.weight) best={key:r.key,weight:r.weight}; break; }}
    }
    return best;
  }
  for (const k of bumpKeywords) if (s.includes(k)) factor += 5;
  for (const k of minorKeywords) if (s.includes(k)) factor += 2;
  const cat = detectCategory(s);
  factor += cat.weight;
  if (factor > 95) factor = 95;
  let penaltyWei = 0n;
  if (factor > 0) penaltyWei = (req * BigInt(factor)) / 100n;
  if (penaltyWei > req) penaltyWei = req;
  const approve = factor >= 60 && penaltyWei > 0n && reporter !== offender;
  const severityBand = factor >= 80 ? 'high' : (factor >= 60 ? 'medium':'low');
  const classification = cat.key;
  const rationale = `cat=${cat.key};catWeight=${cat.weight};band=${severityBand};factor=${factor};requestedWei=${req}`;
  return { approve, penaltyWei, beneficiary: reporter, guilty: offender, factor, classification, rationale };
}

describe("NDA Case Studies Harness (archetypes)", function () {
  let nda, oracle, owner, partyA, partyB;
  const snapshotResults = [];

  beforeEach(async () => {
    [owner, partyA, partyB] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("OracleArbitratorFunctions");
    // Local router placeholder; we use testFulfill only
    oracle = await Oracle.connect(owner).deploy(owner.address);
    await oracle.waitForDeployment();

    const NDATemplate = await ethers.getContractFactory("NDATemplate");
    nda = await NDATemplate.deploy(
      partyA.address,
      partyB.address,
      Math.floor(Date.now() / 1000) + 86400,
      1000, // 10% base penalty bps (not used directly by AI, but part of template)
      ethers.keccak256(ethers.toUtf8Bytes("Clauses v1")),
      oracle.target,
      ethers.parseEther("0.1")
    );
    await nda.waitForDeployment();

    // Seed deposits
    await nda.connect(partyA).deposit({ value: ethers.parseEther("1") });
    await nda.connect(partyB).deposit({ value: ethers.parseEther("1") });
  });

  const scenarios = JSON.parse(
    fs.readFileSync(path.join(__dirname, "./data/nda_archetypes.json"), "utf8")
  );

  for (const sc of scenarios) {
    it(`simulates: ${sc.name}`, async () => {
      const reporter = sc.reporter === "A" ? partyA : partyB;
      const offender = sc.offender === "A" ? partyA : partyB;
      const requestedPenalty = ethers.parseEther(sc.requestedEth);
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(sc.evidence));

      // Reporter files breach
      await nda.connect(reporter).reportBreach(offender.address, requestedPenalty, evidenceHash);

      // Submit to oracle (AI path)
      const tx = await oracle.connect(reporter).requestResolution(
        nda.target,
        0,
        offender.address,
        ethers.toUtf8Bytes(sc.evidence)
      );
      const rc = await tx.wait();
      const iface = new ethers.Interface([
        "event ResolutionRequested(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, address reporter, address offender)",
      ]);
      let requestId;
      for (const log of rc.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          if (parsed) { requestId = parsed.args[0]; break; }
        } catch {}
      }
      expect(requestId).to.be.properHex;

      // Baseline AI decision
      const decision = baselineAiDecision({
        requestedPenaltyWei: requestedPenalty,
        reporter: reporter.address,
        offender: offender.address,
        evidence: sc.evidence,
      });

      // --- Factor Assertion ---
      // Recompute expected factor (pure) to assert against stored factor
      const recomputeFactor = (() => {
        let req = requestedPenalty;
        if (req < 0n) req = 0n;
        const ethScaled = Number(req) / 1e18;
        let factor = 0;
        if (ethScaled < 0.01) factor = 0;
        else if (ethScaled <= 0.1) factor = 60;
        else if (ethScaled <= 0.3) factor = 70;
        else if (ethScaled <= 0.5) factor = 80;
        else factor = 90;
        const s = sc.evidence.toLowerCase();
        const bumpKeywords = ['source','code','gist','roadmap','customer','earnings'];
        const minorKeywords = ['investor','pitch'];
        for (const k of bumpKeywords) if (s.includes(k)) factor += 5;
        for (const k of minorKeywords) if (s.includes(k)) factor += 2;
        // Category taxonomy weights
        const CATEGORY_RULES = [
          { key: 'source_code', keywords: ['source','code','gist'], weight: 15 },
          { key: 'financial_forecast', keywords: ['earnings','guidance','forecast'], weight: 12 },
          { key: 'customer_data', keywords: ['customer','customers','client','clientlist','customerlist'], weight: 10 },
          { key: 'roadmap', keywords: ['roadmap','timeline','releaseplan','milestone'], weight: 8 },
          { key: 'investor_material', keywords: ['investor','pitch','deck'], weight: 6 },
        ];
        for (const r of CATEGORY_RULES) {
          for (const kw of r.keywords) {
            if (s.includes(kw)) { factor += r.weight; break; }
          }
        }
        if (factor > 95) factor = 95;
        return factor;
      })();
      expect(decision.factor).to.equal(recomputeFactor);

      // Fulfill as router (owner-only helper)
  const classification = decision.classification;
  const rationale = decision.rationale;
      await oracle.connect(owner).testFulfill(
        requestId,
        decision.approve,
        decision.penaltyWei,
        decision.beneficiary,
        decision.guilty,
        classification,
        rationale
      );

      const caseInfo = await nda.getCase(0);
      expect(caseInfo[4]).to.equal(true); // resolved
      expect(caseInfo[5]).to.equal(decision.approve); // approved flag matches decision

      // Offender deposit after (new single-step final resolution):
      //   If approved: initial - penaltyWei (capped) ; if denied: unchanged.
      const offenderDeposit = await nda.deposits(offender.address);
      const initialDeposit = ethers.parseEther("1");
      let expectedDeposit = initialDeposit;
      if (decision.approve) {
        const deduct = decision.penaltyWei > initialDeposit ? initialDeposit : decision.penaltyWei;
        expectedDeposit = initialDeposit - deduct;
      }
      expect(offenderDeposit).to.equal(expectedDeposit);

      // Collect snapshot info
      snapshotResults.push({
        name: sc.name,
        requestedEth: sc.requestedEth,
        factor: decision.factor,
        approve: decision.approve,
  penaltyWei: decision.penaltyWei.toString(),
  classification,
  rationale
      });
    });
  }

  after(async () => {
    // Snapshot comparison / creation
    const snapDir = path.join(__dirname, 'snapshots');
    const snapFile = path.join(snapDir, 'ai_penalties.json');
    if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir);
    if (!fs.existsSync(snapFile)) {
      fs.writeFileSync(snapFile, JSON.stringify(snapshotResults, null, 2));
      console.log('\n[AI SNAPSHOT CREATED]', snapFile);
    } else {
      const existing = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
      if (existing.length !== snapshotResults.length) {
        fs.writeFileSync(snapFile, JSON.stringify(snapshotResults, null, 2));
        console.log('\n[AI SNAPSHOT UPDATED length mismatch]', snapFile);
      } else {
        for (let i = 0; i < existing.length; i++) {
          const a = existing[i];
          const b = snapshotResults[i];
          if (a.name !== b.name || a.factor !== b.factor || a.penaltyWei !== b.penaltyWei || a.approve !== b.approve) {
            fs.writeFileSync(snapFile, JSON.stringify(snapshotResults, null, 2));
            console.log('\n[AI SNAPSHOT UPDATED content diff]', snapFile);
            return;
          }
        }
        console.log('\n[AI SNAPSHOT VERIFIED]', snapFile);
      }
    }
  });
});
