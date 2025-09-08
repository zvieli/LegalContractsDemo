import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

describe("ContractFactory", function () {
  let factory;
  let arbitrator;
  let landlord, tenant, partyA, partyB, other;
  let mockPriceFeed;

  beforeEach(async function () {
    [landlord, tenant, partyA, partyB, other] = await ethers.getSigners();

    // Deploy Arbitrator
    const Arbitrator = await ethers.getContractFactory("Arbitrator");
    arbitrator = await Arbitrator.deploy();
    await arbitrator.waitForDeployment();

    // Deploy MockPriceFeed
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockPriceFeed = await MockPriceFeed.deploy(2000);
    await mockPriceFeed.waitForDeployment();

    // Deploy Factory
  const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();
  });

  describe("createRentContract", function () {
    it("should create rent contract successfully", async function () {
      const tx = await factory.connect(landlord).createRentContract(
          tenant.address,
          100,
          mockPriceFeed.target,
          0
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "RentContractCreated"
      );
      expect(event).to.not.be.undefined;
    });
  });

  describe("createNDA", function () {
    const expiryDate = Math.floor(Date.now() / 1000) + 86400;
    const penaltyBps = 500;
    const minDeposit = ethers.parseEther("0.1");
    const clausesHash = ethers.keccak256(ethers.toUtf8Bytes("NDA clauses"));

    it("should create NDA with arbitrator", async function () {
      const tx = await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        penaltyBps,
        clausesHash,
        arbitrator.target,
        minDeposit
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "NDACreated"
      );
      expect(event).to.not.be.undefined;
    });

    it("should create NDA without arbitrator", async function () {
      const tx = await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        penaltyBps,
        clausesHash,
        ethers.ZeroAddress,
        minDeposit
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "NDACreated"
      );
      expect(event).to.not.be.undefined;
    });
  });

  describe("Contract Management", function () {
    beforeEach(async function () {
      // Create some contracts first
      await factory.connect(landlord).createRentContract(
        tenant.address,
        100,
        mockPriceFeed.target
      );

      const expiryDate = Math.floor(Date.now() / 1000) + 86400;
      await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        500,
        ethers.keccak256(ethers.toUtf8Bytes("Clauses")),
        ethers.ZeroAddress,
        ethers.parseEther("0.1")
      );
    });

    it("should return all contracts", async function () {
      const contracts = await factory.getAllContracts();
      expect(contracts.length).to.equal(2);
    });

    it("should return contracts by creator", async function () {
      const landlordContracts = await factory.getContractsByCreator(landlord.address);
      const partyAContracts = await factory.getContractsByCreator(partyA.address);

      expect(landlordContracts.length).to.equal(1);
      expect(partyAContracts.length).to.equal(1);
    });
  });
});