import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

describe("OracleArbitratorFunctions -> NDATemplate integration", function () {
  let nda, oracle, owner, partyA, partyB;

  beforeEach(async () => {
    [owner, partyA, partyB] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("OracleArbitratorFunctions");
    // For local/tests we can pass any address as router; we won't invoke real sendRequest
    oracle = await Oracle.connect(owner).deploy(owner.address);
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

    await nda.connect(partyA).deposit({ value: ethers.parseEther("0.5") });
    await nda.connect(partyB).deposit({ value: ethers.parseEther("0.5") });
  });

  it("should request and test-fulfill resolution", async () => {
    const requestedPenalty = ethers.parseEther("0.2");
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

    await nda.connect(partyA).reportBreach(partyB.address, requestedPenalty, evidenceHash);

    const req = await oracle.connect(partyA).requestResolution(
      nda.target,
      0,
      partyB.address,
      ethers.toUtf8Bytes("ipfs://ref")
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
    expect(requestId).to.be.properHex;

    // Simulate oracle callback including classification & rationale
    await oracle.connect(owner).testFulfill(
      requestId,
      true,
      ethers.parseEther("0.15"),
      partyA.address,
      partyB.address,
      'generic',
      'cat=generic;test'
    );

    const caseInfo = await nda.getCase(0);
    expect(caseInfo[4]).to.equal(true);
    expect(caseInfo[5]).to.equal(true);

  const offenderDeposit = await nda.deposits(partyB.address);
  // Single-step final resolution: only penaltyWei (0.15) deducted from 0.5 => 0.35 remaining
  expect(offenderDeposit).to.equal(ethers.parseEther("0.35"));
  });
});
