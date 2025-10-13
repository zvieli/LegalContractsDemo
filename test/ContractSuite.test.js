// Unified Contract Suite: Factory, Rent, NDA, Validations
import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Unified Contract Suite", function () {
  let factory, arbitrationService, landlord, tenant, partyA, partyB, other;

  beforeEach(async function () {
    [landlord, tenant, partyA, partyB, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();
    const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
    arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();
    await factory.setDefaultArbitrationService(arbitrationService.target, 0);
  });

  describe("Factory", function () {
    it("should create rent contract successfully", async function () {
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const propertyId = 1;
      const initialEvidenceUri = "ipfs://test";
      const tx = await factory.connect(landlord)["createRentContract(address,uint256,address,uint256,uint256,string)"](
        tenant.address,
        ethers.parseEther("1.0"),
        CHAINLINK_ETH_USD,
        dueDate,
        propertyId,
        initialEvidenceUri
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "RentContractCreated");
      expect(event).to.not.be.undefined;
    });
    // ...existing Factory tests...
  });

  describe("RentContract Validations", function () {
    it("should revert with zero tenant address", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          ZERO_ADDRESS,
          100,
          CHAINLINK_ETH_USD,
          0
        )
      ).to.be.revertedWithCustomError(factory, 'ZeroTenant');
    });
    // ...other validation tests...
  });

  describe("NDA Validations", function () {
    it("should revert with zero partyB address", async function () {
      const expiryDate = Math.floor(Date.now() / 1000) + 86400;
      const penaltyBps = 500;
      const minDeposit = ethers.parseEther("0.1");
      const clausesHash = ethers.keccak256(ethers.toUtf8Bytes("Some NDA clause"));
      await expect(
        factory.connect(partyA).createNDA(
          ZERO_ADDRESS,
          expiryDate,
          penaltyBps,
          clausesHash,
          minDeposit
        )
      ).to.be.revertedWithCustomError(factory, 'ZeroPartyB');
    });
    // ...other NDA validation tests...
  });

  describe("RentContract", function () {
    let rentContract;
    beforeEach(async function () {
      const tx = await factory.connect(landlord).createRentContract(
        tenant.address,
        ethers.parseEther("0.5"),
        CHAINLINK_ETH_USD,
        0
      );
      const receipt = await tx.wait();
      const evt = receipt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
      const deployedAddr = evt.args.contractAddress;
      rentContract = await ethers.getContractAt('TemplateRentContract', deployedAddr);
    });
    it("should deploy with correct initial values", async function () {
      expect(await rentContract.landlord()).to.equal(landlord.address);
      expect(await rentContract.tenant()).to.equal(tenant.address);
      expect(await rentContract.rentAmount()).to.equal(ethers.parseEther("0.5"));
      expect(await rentContract.active()).to.be.true;
    });
    // ...other rent contract tests...
  });
});
