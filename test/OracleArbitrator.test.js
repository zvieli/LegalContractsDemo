import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

// Minimal happy-path test to exercise OracleArbitrator resolving an NDA case

describe("OracleArbitrator -> NDATemplate integration", function () {
  let nda, oracle, owner, partyA, partyB, reporter, offender, router;

  beforeEach(async () => {
    [owner, partyA, partyB, router] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("OracleArbitrator");
    oracle = await Oracle.connect(owner).deploy(router.address);
    await oracle.waitForDeployment();

    const Factory = await ethers.getContractFactory("ContractFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    const tx = await factory.connect(partyA).createNDA(
      partyB.address,
      Math.floor(Date.now() / 1000) + 86400,
      1000,
      ethers.keccak256(ethers.toUtf8Bytes("Clauses")),
      oracle.target,
      ethers.parseEther("0.1")
    );
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => l.fragment && l.fragment.name === 'NDACreated');
    nda = await ethers.getContractAt('NDATemplate', log.args.contractAddress);

    // fund deposits
    await nda.connect(partyA).deposit({ value: ethers.parseEther("0.5") });
    await nda.connect(partyB).deposit({ value: ethers.parseEther("0.5") });

    reporter = partyA;
    offender = partyB;
  });

  it("should request and fulfill an oracle resolution (approve with penalty)", async () => {
    const requestedPenalty = ethers.parseEther("0.2");
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

    const tx = await nda.connect(reporter).reportBreach(offender.address, requestedPenalty, evidenceHash);
    await tx.wait();

    // Request oracle resolution
    const req = await oracle.connect(reporter).requestResolution(
      nda.target,
      0,
      offender.address,
      ethers.toUtf8Bytes("ipfs://evidence-ref")
    );
    const receipt = await req.wait();

    // Pull requestId from event
    const iface = new ethers.Interface([
      "event ResolutionRequested(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, address reporter, address offender)"
    ]);
    let requestId;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed) {
          requestId = parsed.args[0];
          break;
        }
      } catch {}
    }
    expect(requestId).to.be.properHex;

    // Fulfill by router (authorized)
    const penalty = ethers.parseEther("0.15"); // <= offender deposit
    await expect(
      oracle.connect(router).fulfill(requestId, true, penalty, reporter.address, offender.address)
    ).to.emit(oracle, "ResolutionFulfilled");

  const caseInfo = await nda.getCase(0);
  expect(caseInfo[4]).to.equal(true); // resolved
  expect(caseInfo[5]).to.equal(true); // approved

  // Offender deposit should be reduced by penalty (0.15) and requestedPenalty payout (0.2) => 0.15 left
  const offenderDeposit = await nda.deposits(offender.address);
  expect(offenderDeposit).to.equal(ethers.parseEther("0.15"));
  });

  it("clamps penalty to offender's deposit", async () => {
    // offender has 0.5; request 1.0
    await nda.connect(reporter).reportBreach(offender.address, ethers.parseEther("1.0"), ethers.ZeroHash);

    const req = await oracle.connect(reporter).requestResolution(
      nda.target,
      0,
      offender.address,
      ethers.toUtf8Bytes("")
    );
    const receipt = await req.wait();

    const iface = new ethers.Interface([
      "event ResolutionRequested(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, address reporter, address offender)"
    ]);
    let requestId;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed) { requestId = parsed.args[0]; break; }
      } catch {}
    }

    await oracle.connect(owner).fulfill(requestId, true, ethers.parseEther("2.0"), reporter.address, offender.address);

    const offenderDeposit = await nda.deposits(offender.address);
    // all 0.5 taken
    expect(offenderDeposit).to.equal(ethers.parseEther("0.0"));
  });
});
