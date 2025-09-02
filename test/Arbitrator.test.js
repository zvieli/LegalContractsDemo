import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

describe("Arbitrator", function () {
  let arbitrator;
  let ndaTemplate;
  let owner, partyA, partyB, other;

  beforeEach(async function () {
    [owner, partyA, partyB, other] = await ethers.getSigners();

    const Arbitrator = await ethers.getContractFactory("Arbitrator");
    arbitrator = await Arbitrator.deploy();
    await arbitrator.waitForDeployment();

    const NDATemplate = await ethers.getContractFactory("NDATemplate");
    ndaTemplate = await NDATemplate.deploy(
      partyA.address,
      partyB.address,
      Math.floor(Date.now() / 1000) + 86400,
      1000,
      ethers.keccak256(ethers.toUtf8Bytes("Test clauses")),
      arbitrator.target,
      ethers.parseEther("0.1")
    );
    await ndaTemplate.waitForDeployment();

    await ndaTemplate.connect(partyA).deposit({ value: ethers.parseEther("0.2") });
    await ndaTemplate.connect(partyB).deposit({ value: ethers.parseEther("0.2") });
  });

  describe("createDisputeForCase", function () {
    it("should create a new dispute", async function () {
      const evidence = ethers.toUtf8Bytes("Test evidence");
      
      const tx = await arbitrator.connect(partyA).createDisputeForCase(
        ndaTemplate.target,
        0,
        evidence
      );
      
      expect(await arbitrator.disputeCounter()).to.equal(1);
    });

    it("should allow anyone to create dispute", async function () {
      const evidence = ethers.toUtf8Bytes("Test evidence");
      
      await expect(
        arbitrator.connect(other).createDisputeForCase(
          ndaTemplate.target,
          0,
          evidence
        )
      ).to.not.be.reverted;
    });
  });

  describe("resolveDispute", function () {
    beforeEach(async function () {
      const evidence = ethers.toUtf8Bytes("Test evidence");
      // create the NDA case first so the arbitrator can reference a valid caseId
      const evidenceHash = ethers.keccak256(evidence);
      await ndaTemplate.connect(partyA).reportBreach(
        partyB.address,
        ethers.parseEther("0.05"),
        evidenceHash
      );

      await arbitrator.connect(partyA).createDisputeForCase(
        ndaTemplate.target,
        0,
        evidence
      );
    });

    it("should resolve dispute by owner", async function () {
      await expect(
        arbitrator.connect(owner).resolveDispute(
          1,
          partyB.address,
          ethers.parseEther("0.05"),
          partyA.address
        )
      ).to.not.be.reverted;
    });
  });
});