import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple baseline "AI" used for local tests: approve=true, penalty = requested/2, beneficiary = reporter, guilty = offender
function baselineAiDecision({ requestedPenaltyWei, reporter, offender }) {
  const penaltyWei = requestedPenaltyWei / 2n;
  return { approve: true, penaltyWei, beneficiary: reporter, guilty: offender };
}

describe("NDA Case Studies Harness (archetypes)", function () {
  let nda, oracle, owner, partyA, partyB;

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
      });

      // Fulfill as router (owner-only helper)
      await oracle.connect(owner).testFulfill(
        requestId,
        decision.approve,
        decision.penaltyWei,
        decision.beneficiary,
        decision.guilty
      );

      const caseInfo = await nda.getCase(0);
      expect(caseInfo[4]).to.equal(true); // resolved
      expect(caseInfo[5]).to.equal(true); // approved

      // Offender deposit after: start(1 ETH) - penaltyWei - requestedPenalty
      const offenderDeposit = await nda.deposits(offender.address);
      const expected = ethers.parseEther("1") - decision.penaltyWei - requestedPenalty;
      expect(offenderDeposit).to.equal(expected);
    });
  }
});
