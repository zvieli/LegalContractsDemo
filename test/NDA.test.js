import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

// Helper function for EIP712 signing
async function signNDAMessage(signer, contract) {
  const domain = {
    name: await contract.CONTRACT_NAME(),
    version: await contract.CONTRACT_VERSION(),
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: contract.target
  };

  const types = {
    NDA: [
      { name: "contractAddress", type: "address" },
      { name: "expiryDate", type: "uint256" },
      { name: "penaltyBps", type: "uint16" },
      { name: "customClausesHash", type: "bytes32" }
    ]
  };

  const value = {
    contractAddress: contract.target,
    expiryDate: await contract.expiryDate(),
    penaltyBps: await contract.penaltyBps(),
    customClausesHash: await contract.customClausesHash()
  };

  return await signer.signTypedData(domain, types, value);
}

describe("NDATemplate", function () {
  let ndaTemplate;
  let arbitrator;
  let partyA, partyB, partyC, admin, other, arbitratorOwner;
  let arbitrationService;

  beforeEach(async function () {
    [admin, partyA, partyB, partyC, other, arbitratorOwner] = await ethers.getSigners();

    // Deploy Arbitrator with separate owner
    const Arbitrator = await ethers.getContractFactory("Arbitrator");
    arbitrator = await Arbitrator.connect(arbitratorOwner).deploy();
    await arbitrator.waitForDeployment();

    // Deploy ArbitrationService and give ownership to the arbitrator so it can apply resolutions
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
  arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();
    await arbitrationService.transferOwnership(arbitrator.target);
    await arbitrator.setArbitrationService(arbitrationService.target);

    // Deploy via factory (enforced)
    const Factory = await ethers.getContractFactory("ContractFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    const tx = await factory.connect(partyA).createNDA(
      partyB.address,
      Math.floor(Date.now() / 1000) + 86400,
      1000,
      ethers.keccak256(ethers.toUtf8Bytes("Test confidentiality clauses")),
      ethers.parseEther("0.1")
    );
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => l.fragment && l.fragment.name === 'NDACreated');
    ndaTemplate = await ethers.getContractAt('NDATemplate', log.args.contractAddress);
    admin = partyA; // factory sets admin = deployer (partyA here)
  // configure the NDA to accept calls from the ArbitrationService
  await ndaTemplate.connect(admin).setArbitrationService(arbitrationService.target);
  });

  describe("Deployment", function () {
    it("should set the correct parties", async function () {
      expect(await ndaTemplate.partyA()).to.equal(partyA.address);
      expect(await ndaTemplate.partyB()).to.equal(partyB.address);
    });

    // removed: templates no longer store a direct `arbitrator` address; use ArbitrationService instead

    it("should set the correct admin", async function () {
      expect(await ndaTemplate.admin()).to.equal(admin.address);
    });

    it("should initialize with active status", async function () {
      expect(await ndaTemplate.active()).to.be.true;
    });
  });

  describe("Contract Information", function () {
    it("should return correct contract name and version", async function () {
      expect(await ndaTemplate.CONTRACT_NAME()).to.equal("NDATemplate");
      expect(await ndaTemplate.CONTRACT_VERSION()).to.equal("1");
    });

    it("should return correct expiry date", async function () {
      const expiryDate = await ndaTemplate.expiryDate();
      expect(expiryDate).to.be.gt(Math.floor(Date.now() / 1000));
    });

    it("should return correct penalty basis points", async function () {
      expect(await ndaTemplate.penaltyBps()).to.equal(1000);
    });

    it("should return correct clauses hash", async function () {
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes("Test confidentiality clauses"));
      expect(await ndaTemplate.customClausesHash()).to.equal(expectedHash);
    });

    it("should return correct minimum deposit", async function () {
      expect(await ndaTemplate.minDeposit()).to.equal(ethers.parseEther("0.1"));
    });
  });

  describe("Party Management", function () {
    it("should recognize valid parties", async function () {
      expect(await ndaTemplate.isParty(partyA.address)).to.be.true;
      expect(await ndaTemplate.isParty(partyB.address)).to.be.true;
    });

    it("should not recognize non-parties", async function () {
      expect(await ndaTemplate.isParty(partyC.address)).to.be.false;
      expect(await ndaTemplate.isParty(other.address)).to.be.false;
    });

    it("should allow admin to add new party", async function () {
      await expect(ndaTemplate.connect(admin).addParty(partyC.address))
        .to.emit(ndaTemplate, "PartyAdded")
        .withArgs(partyC.address);

      expect(await ndaTemplate.isParty(partyC.address)).to.be.true;
    });

    it("should revert when non-admin tries to add party", async function () {
      // admin is partyA (set during factory deployment); use partyB as non-admin
      await expect(ndaTemplate.connect(partyB).addParty(partyC.address))
        .to.be.revertedWith("Only admin");
    });

    it("should return all parties", async function () {
      const parties = await ndaTemplate.getParties();
      expect(parties).to.have.lengthOf(2);
      expect(parties).to.include(partyA.address);
      expect(parties).to.include(partyB.address);
    });
  });

  describe("Signing Process", function () {
// test/NDA.test.js - בתוך describe("Signing Process")
it("should allow parties to sign with valid signature", async function () {
  const signature = await signNDAMessage(partyA, ndaTemplate);
  
  // פשוט בודקים שהעסקה לא נכשלת ושהחתימה נרשמה
  await expect(ndaTemplate.connect(partyA).signNDA(signature))
    .to.emit(ndaTemplate, "NDASigned");

  expect(await ndaTemplate.signedBy(partyA.address)).to.be.true;
});

    it("should revert when non-party tries to sign", async function () {
      const signature = await signNDAMessage(other, ndaTemplate);
      
      await expect(ndaTemplate.connect(other).signNDA(signature))
        .to.be.revertedWith("Invalid signer (not a party)");
    });

    it("should revert when party tries to sign twice", async function () {
      const signature = await signNDAMessage(partyA, ndaTemplate);
      await ndaTemplate.connect(partyA).signNDA(signature);

      // Try to sign again
      await expect(ndaTemplate.connect(partyA).signNDA(signature))
        .to.be.revertedWith("Already signed");
    });

    it("should detect fully signed contract", async function () {
      // Sign with partyA
      const signatureA = await signNDAMessage(partyA, ndaTemplate);
      await ndaTemplate.connect(partyA).signNDA(signatureA);
      
      expect(await ndaTemplate.isFullySigned()).to.be.false;

      // Sign with partyB
      const signatureB = await signNDAMessage(partyB, ndaTemplate);
      await ndaTemplate.connect(partyB).signNDA(signatureB);
      
      expect(await ndaTemplate.isFullySigned()).to.be.true;
    });
  });

  describe("Deposit Management", function () {
    it("should accept deposits from parties", async function () {
      const depositAmount = ethers.parseEther("0.5");
      
      await expect(ndaTemplate.connect(partyA).deposit({ value: depositAmount }))
        .to.emit(ndaTemplate, "DepositMade")
        .withArgs(partyA.address, depositAmount);

      expect(await ndaTemplate.deposits(partyA.address)).to.equal(depositAmount);
    });

    it("should revert when non-party tries to deposit", async function () {
      await expect(ndaTemplate.connect(other).deposit({ value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Only party");
    });

    it("should revert when contract is inactive", async function () {
      await ndaTemplate.connect(admin).deactivate("Test deactivation");
      
      await expect(ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Contract inactive");
    });

    it("should track multiple deposits", async function () {
      await ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.3") });
      await ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.2") });
      
      expect(await ndaTemplate.deposits(partyA.address)).to.equal(ethers.parseEther("0.5"));
    });
  });

  describe("Breach Reporting", function () {
    beforeEach(async function () {
      // Setup deposits for testing
      await ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.5") });
      await ndaTemplate.connect(partyB).deposit({ value: ethers.parseEther("0.5") });
    });

    it("should allow party to report breach", async function () {
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("Evidence of breach"));
      const requestedPenalty = ethers.parseEther("0.1");
      
      await expect(ndaTemplate.connect(partyA).reportBreach(
        partyB.address,
        requestedPenalty,
        evidenceHash
      ))
        .to.emit(ndaTemplate, "BreachReported")
        .withArgs(0, partyA.address, partyB.address, requestedPenalty, evidenceHash);

      expect(await ndaTemplate.getCasesCount()).to.equal(1);
    });

    it("should revert when reporting breach against non-party", async function () {
      await expect(ndaTemplate.connect(partyA).reportBreach(
        other.address,
        ethers.parseEther("0.1"),
        ethers.keccak256(ethers.toUtf8Bytes("Evidence"))
      )).to.be.revertedWith("Offender not a party");
    });

    it("should revert when reporting breach against self", async function () {
      await expect(ndaTemplate.connect(partyA).reportBreach(
        partyA.address,
        ethers.parseEther("0.1"),
        ethers.keccak256(ethers.toUtf8Bytes("Evidence"))
      )).to.be.revertedWith("Cannot accuse self");
    });

    it("should revert when offender has insufficient deposit", async function () {
      // Create a party with small deposit
      await ndaTemplate.connect(admin).addParty(partyC.address);
      await ndaTemplate.connect(partyC).deposit({ value: ethers.parseEther("0.05") }); // Below min
      
      await expect(ndaTemplate.connect(partyA).reportBreach(
        partyC.address,
        ethers.parseEther("0.1"),
        ethers.keccak256(ethers.toUtf8Bytes("Evidence"))
      )).to.be.revertedWith("Offender has no minimum deposit");
    });

    it("should return correct case information", async function () {
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("Evidence"));
      const requestedPenalty = ethers.parseEther("0.1");
      
      await ndaTemplate.connect(partyA).reportBreach(
        partyB.address,
        requestedPenalty,
        evidenceHash
      );

      const caseInfo = await ndaTemplate.getCase(0);
      expect(caseInfo[0]).to.equal(partyA.address); // reporter
      expect(caseInfo[1]).to.equal(partyB.address); // offender
      expect(caseInfo[2]).to.equal(requestedPenalty); // requestedPenalty
      expect(caseInfo[3]).to.equal(evidenceHash); // evidenceHash
      expect(caseInfo[4]).to.be.false; // resolved
      expect(caseInfo[5]).to.be.false; // approved
    });
  });

  // Voting removed: disputes must be handled by an arbitrator or external oracle.

  describe("Contract Deactivation", function () {
    it("should allow admin to deactivate", async function () {
      await expect(ndaTemplate.connect(admin).deactivate("Test reason"))
        .to.emit(ndaTemplate, "ContractDeactivated")
        .withArgs(admin.address, "Test reason");

      expect(await ndaTemplate.active()).to.be.false;
    });

    it("should allow deactivation after expiry", async function () {
      // Use chain time to avoid flakiness when previous tests moved time forward
      const latestBlock = await ethers.provider.getBlock("latest");
      const chainNow = Number(latestBlock.timestamp);
      const futureDate = chainNow + 3600; // +1 hour from chain time

      const Factory = await ethers.getContractFactory('ContractFactory');
      const factory = await Factory.deploy();
      await factory.waitForDeployment();
      const tx3 = await factory.connect(partyA).createNDA(
        partyB.address,
        futureDate,
        1000,
        ethers.keccak256(ethers.toUtf8Bytes('Test')),
        ethers.parseEther('0.1')
      );
      const r3 = await tx3.wait();
      const log3 = r3.logs.find(l => l.fragment && l.fragment.name === 'NDACreated');
      const testNDA = await ethers.getContractAt('NDATemplate', log3.args.contractAddress);

      // Fast forward time beyond expiry
      await ethers.provider.send("evm_setNextBlockTimestamp", [futureDate + 1]);
      await ethers.provider.send("evm_mine");

      await expect(testNDA.connect(admin).deactivate("Expired")).to.not.be.reverted;
    });

    it("should revert when unauthorized user tries to deactivate", async function () {
      // admin == partyA; choose partyB as unauthorized
      await expect(ndaTemplate.connect(partyB).deactivate("Unauthorized"))
        .to.be.revertedWith("Not authorized");
    });
  });

  describe("Withdrawal System", function () {
 // test/NDA.test.js - בתוך describe("Withdrawal System")
// test/NDA.test.js - בתוך describe("Withdrawal System")
it("should allow withdrawal after deactivation and resolution", async function () {
  // Setup deposits and breach report
  await ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.5") });
  await ndaTemplate.connect(partyB).deposit({ value: ethers.parseEther("0.5") });
  
  await ndaTemplate.connect(partyA).reportBreach(
    partyB.address,
    ethers.parseEther("0.1"),
    ethers.keccak256(ethers.toUtf8Bytes("Evidence"))
  );

  // Create dispute in arbitrator
  const evidence = ethers.toUtf8Bytes("Arbitration evidence");
  await arbitrator.connect(partyA).createDisputeForCase(
    ndaTemplate.target,
    0,
    evidence
  );

  // Resolve through arbitrator
  await arbitrator.connect(arbitratorOwner).resolveDispute(
    1,
    partyB.address,
    ethers.parseEther("0.05"),
    partyA.address
  );

  // After Arbitrator resolves (via ArbitrationService) the case should be resolved on the template
  const caseInfo = await ndaTemplate.getCase(0);
  expect(caseInfo.resolved).to.be.true;

  // Verify the case is resolved
  const finalCaseInfo = await ndaTemplate.getCase(0);
  expect(finalCaseInfo.resolved).to.be.true;

  // Deactivate contract
  await ndaTemplate.connect(admin).deactivate("Test withdrawal");
  expect(await ndaTemplate.active()).to.be.false;

  expect(await ndaTemplate.canWithdraw()).to.be.true;

  await expect(ndaTemplate.connect(partyA).withdrawDeposit(ethers.parseEther("0.4")))
    .to.emit(ndaTemplate, "DepositWithdrawn")
    .withArgs(partyA.address, ethers.parseEther("0.4"));
});

    it("should revert withdrawal when contract is active", async function () {
      // Create fresh NDA via factory
      const Factory = await ethers.getContractFactory('ContractFactory');
      const factory = await Factory.deploy();
      await factory.waitForDeployment();
      const tx4 = await factory.connect(partyA).createNDA(
        partyB.address,
        Math.floor(Date.now() / 1000) + 86400,
        1000,
        ethers.keccak256(ethers.toUtf8Bytes('Test')),
        ethers.parseEther('0.1')
      );
      const r4 = await tx4.wait();
      const log4 = r4.logs.find(l => l.fragment && l.fragment.name === 'NDACreated');
      const activeNDA = await ethers.getContractAt('NDATemplate', log4.args.contractAddress);
      await activeNDA.connect(partyA).deposit({ value: ethers.parseEther('0.5') });
      await expect(activeNDA.connect(partyA).withdrawDeposit(ethers.parseEther('0.1')))
        .to.be.revertedWith('Cannot withdraw yet');
    });
  });

  describe("Contract Status", function () {
    it("should return correct contract status", async function () {
      const status = await ndaTemplate.getContractStatus();
      
      expect(status[0]).to.be.true; // isActive
      expect(status[1]).to.be.false; // fullySigned
      expect(status[2]).to.equal(0); // totalDeposits
      expect(status[3]).to.equal(0); // activeCases
    });

    it("should update status after deposits and cases", async function () {
      await ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.3") });
      await ndaTemplate.connect(partyB).deposit({ value: ethers.parseEther("0.2") });
      
      await ndaTemplate.connect(partyA).reportBreach(
        partyB.address,
        ethers.parseEther("0.1"),
        ethers.keccak256(ethers.toUtf8Bytes("Evidence"))
      );

      const status = await ndaTemplate.getContractStatus();
      
      expect(status[2]).to.equal(ethers.parseEther("0.5")); // totalDeposits
      expect(status[3]).to.equal(1); // activeCases
    });
  });
});

// Reveal & appeal windows tests (merged into main NDA test file)
describe("NDATemplate - reveal & appeal windows", function () {
  let ndaR, factoryR, adminR, partyAR, partyBR, partyCR, otherR, arbitratorR;

  beforeEach(async function () {
    [adminR, partyAR, partyBR, partyCR, otherR] = await ethers.getSigners();

    const Arbitrator = await ethers.getContractFactory("Arbitrator");
    arbitratorR = await Arbitrator.deploy();
    await arbitratorR.waitForDeployment();

    const Factory = await ethers.getContractFactory("ContractFactory");
    factoryR = await Factory.deploy();
    await factoryR.waitForDeployment();

    const tx = await factoryR.connect(adminR).createNDA(
      partyBR.address,
      Math.floor(Date.now() / 1000) + 86400,
      1000,
      ethers.keccak256(ethers.toUtf8Bytes("Test clauses")),
      ethers.parseEther('0.1')
    );
    const r = await tx.wait();
    const log = r.logs.find(l => l.fragment && l.fragment.name === 'NDACreated');
    ndaR = await ethers.getContractAt('NDATemplate', log.args.contractAddress);
  });

  it("sets reveal deadline at report time and verifies hash on reveal", async function () {
    // admin sets reveal window
    await ndaR.connect(adminR).setRevealWindowSeconds(3600);

    const uri = "ipfs://QmExampleCid123";
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(uri));

    // deposits
    await ndaR.connect(adminR).deposit({ value: ethers.parseEther('0.5') });
    await ndaR.connect(partyBR).deposit({ value: ethers.parseEther('0.5') });

    // report
    await expect(ndaR.connect(adminR).reportBreach(partyBR.address, ethers.parseEther('0.1'), evidenceHash))
      .to.emit(ndaR, 'BreachReported');

    const dl = await ndaR.getRevealDeadline(0);
    expect(dl).to.be.gt(0);

    // wrong reveal should revert
    await expect(ndaR.connect(adminR).revealEvidence(0, "ipfs://wrong"))
      .to.be.revertedWith('Evidence hash mismatch');

    // proper reveal works
    await expect(ndaR.connect(adminR).revealEvidence(0, uri))
      .to.emit(ndaR, 'EvidenceRevealed')
      .withArgs(0, uri);

    const stored = await ndaR.getEvidenceURI(0);
    expect(stored).to.equal(uri);
  });

  it("rejects reveal after reveal window expires", async function () {
    await ndaR.connect(adminR).setRevealWindowSeconds(10); // short window

    const uri = "ipfs://QmShortWindow";
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(uri));

    await ndaR.connect(adminR).deposit({ value: ethers.parseEther('0.5') });
    await ndaR.connect(partyBR).deposit({ value: ethers.parseEther('0.5') });

    await ndaR.connect(adminR).reportBreach(partyBR.address, ethers.parseEther('0.1'), evidenceHash);

    // advance time beyond window
    await ethers.provider.send('evm_increaseTime', [20]);
    await ethers.provider.send('evm_mine');

    await expect(ndaR.connect(adminR).revealEvidence(0, uri)).to.be.revertedWith('Reveal window closed');
  });

  it("defers enforcement when appeal window set and finalizes after expiry", async function () {
    // set appeal window so enforcement is deferred
    await ndaR.connect(adminR).setAppealWindowSeconds(60);

    // deposits
    await ndaR.connect(adminR).deposit({ value: ethers.parseEther('1') });
    await ndaR.connect(partyBR).deposit({ value: ethers.parseEther('1') });

    // report
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
    await ndaR.connect(adminR).reportBreach(partyBR.address, ethers.parseEther('0.3'), evidenceHash);

    // resolve via arbitrator: deploy and use an arbitrator to resolve the case
    const Arbitrator = await ethers.getContractFactory('Arbitrator');
    const arb = await Arbitrator.deploy();
    await arb.waitForDeployment();
    // set the NDA's arbitrator to the deployed arb by creating a new NDA with that arbitrator
    const Factory = await ethers.getContractFactory('ContractFactory');
    const tempFactory = await Factory.deploy();
    await tempFactory.waitForDeployment();
    const tx = await tempFactory.connect(adminR).createNDA(
      partyBR.address,
      Math.floor(Date.now() / 1000) + 86400,
      1000,
      ethers.keccak256(ethers.toUtf8Bytes('Test clauses')),
      ethers.parseEther('0.1')
    );
    const r = await tx.wait();
    const log = r.logs.find(l => l.fragment && l.fragment.name === 'NDACreated');
    const ndaWithArb = await ethers.getContractAt('NDATemplate', log.args.contractAddress);

    // deploy an ArbitrationService and transfer ownership to the arbitrator so it can apply resolutions
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    const svc = await ArbitrationService.deploy();
    await svc.waitForDeployment();
    await svc.transferOwnership(arb.target);
    await arb.setArbitrationService(svc.target);
    await ndaWithArb.connect(adminR).setArbitrationService(svc.target);

  // ensure the new NDA uses the same appeal window behavior as the test NDA
  await ndaWithArb.connect(adminR).setAppealWindowSeconds(60);

    // deposit and report on the NDAWithArb
    await ndaWithArb.connect(adminR).deposit({ value: ethers.parseEther('1') });
    await ndaWithArb.connect(partyBR).deposit({ value: ethers.parseEther('1') });
    await ndaWithArb.connect(adminR).reportBreach(partyBR.address, ethers.parseEther('0.3'), ethers.keccak256(ethers.toUtf8Bytes('evidence')));

    // create dispute and resolve via arbitrator
    const evidence = ethers.toUtf8Bytes('arb-evidence');
    await arb.connect(adminR).createDisputeForCase(ndaWithArb.target, 0, evidence);
    await arb.connect(adminR).resolveDispute(1, partyBR.address, ethers.parseEther('0.3'), adminR.address);

  // Now the pending enforcement should be present on ndaWithArb (deferred enforcement)
  const pendingArb = await ndaWithArb.getPendingEnforcement(0);
  expect(pendingArb.exists).to.be.true;
  expect(pendingArb.appliedPenalty).to.equal(ethers.parseEther('0.3'));

  // deposits should remain on the NDA with the arbitrator until finalized
  const before = await ndaWithArb.deposits(partyBR.address);
  expect(before).to.equal(ethers.parseEther('1'));

    // advance time past appeal window
    await ethers.provider.send('evm_increaseTime', [61]);
    await ethers.provider.send('evm_mine');

    // finalize enforcement on the NDA instance we used
    await expect(ndaWithArb.connect(adminR).finalizeEnforcement(0))
      .to.emit(ndaWithArb, 'PenaltyEnforced')
      .withArgs(partyBR.address, ethers.parseEther('0.3'), adminR.address);

    const after = await ndaWithArb.deposits(partyBR.address);
    expect(after).to.equal(ethers.parseEther('0.7'));

    const pending2 = await ndaWithArb.getPendingEnforcement(0);
    expect(pending2.exists).to.be.false;
  });
});