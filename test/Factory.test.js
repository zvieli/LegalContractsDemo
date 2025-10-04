import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

describe("ContractFactory", function () {
  let factory;
  let arbitrator;
  let landlord, tenant, partyA, partyB, other;
    let priceFeed;

  beforeEach(async function () {
    [landlord, tenant, partyA, partyB, other] = await ethers.getSigners();

  // Deploy ArbitrationService
  const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
  const arbitrationService = await ArbitrationService.deploy();
  await arbitrationService.waitForDeployment();

  // Deploy Arbitrator with arbitrationService address
  const Arbitrator = await ethers.getContractFactory("Arbitrator");
  arbitrator = await Arbitrator.deploy(arbitrationService.target);
  await arbitrator.waitForDeployment();

      // Use real Chainlink ETH/USD aggregator address
      const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
      priceFeed = CHAINLINK_ETH_USD;

    // Deploy Factory
    const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // Set default arbitration service and required deposit for rent contracts
    await factory.connect(landlord).setDefaultArbitrationService(arbitrator.target, ethers.parseEther("0.1"));
  });

  describe("createRentContract", function () {
    it("should create rent contract successfully", async function () {
      // Use the full argument list for the latest TemplateRentContract
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const propertyId = 1;
      const initialEvidenceUri = "ipfs://test";
      // The factory sets default arbitration service and required deposit internally
      // The factory's createRentContract matches the deployer signature
      // Use the full function signature to resolve overload ambiguity
        const tx = await factory.connect(landlord)["createRentContract(address,uint256,address,uint256,uint256,string)"](
          tenant.address,
          ethers.parseEther("1.0"),
          priceFeed,
          dueDate,
          propertyId,
          initialEvidenceUri
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
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const propertyId = 1;
      const initialEvidenceUri = "ipfs://test";
        await factory.connect(landlord)["createRentContract(address,uint256,address,uint256,uint256,string)"](
          tenant.address,
          ethers.parseEther("1.0"),
          priceFeed,
          dueDate,
          propertyId,
          initialEvidenceUri
        );

      const expiryDate = Math.floor(Date.now() / 1000) + 86400;
      await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        500,
        ethers.keccak256(ethers.toUtf8Bytes("Clauses")),
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