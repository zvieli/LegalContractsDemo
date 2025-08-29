import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("ContractFactory with Validations", function () {
  let factory;
  let landlord, tenant, partyA, partyB, other;
  let mockPriceFeed;

  beforeEach(async function () {
    [landlord, tenant, partyA, partyB, other] = await ethers.getSigners();

    // Deploy MockPriceFeed
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockPriceFeed = await MockPriceFeed.deploy(2000);
    await mockPriceFeed.waitForDeployment();

    // Deploy Factory 
    const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();
  });

  describe("createRentContract Validations", function () {
    it("should revert with zero tenant address", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          ZERO_ADDRESS, // tenant = 0
          100,
          mockPriceFeed.target
        )
      ).to.be.revertedWith("Tenant cannot be zero address");
    });

    it("should revert when landlord is also tenant", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          landlord.address, // tenant = landlord
          100,
          mockPriceFeed.target
        )
      ).to.be.revertedWith("Landlord cannot be tenant");
    });

    it("should revert with zero rent amount", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          tenant.address,
          0, // rent = 0
          mockPriceFeed.target
        )
      ).to.be.revertedWith("Rent amount must be greater than 0");
    });

    it("should revert with zero price feed address", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          tenant.address,
          100,
          ZERO_ADDRESS // priceFeed = 0
        )
      ).to.be.revertedWith("Price feed cannot be zero address");
    });

    it("should revert with EOA as price feed", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          tenant.address,
          100,
          tenant.address // EOA instead of contract
        )
      ).to.be.revertedWith("Price feed must be a contract");
    });
  });

  describe("createNDA Validations", function () {
    const expiryDate = Math.floor(Date.now() / 1000) + 86400;
    const pastDate = Math.floor(Date.now() / 1000) - 86400;
    const penaltyBps = 500;
    const minDeposit = ethers.parseEther("0.1");
    const clausesHash = ethers.keccak256(ethers.toUtf8Bytes("Some NDA clause"));

    it("should revert with zero partyB address", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          ZERO_ADDRESS, // partyB = 0
          expiryDate,
          penaltyBps,
          clausesHash,
          ZERO_ADDRESS,
          minDeposit
        )
      ).to.be.revertedWith("Party B cannot be zero address");
    });

    it("should revert when partyA is also partyB", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyA.address, // partyB = partyA
          expiryDate,
          penaltyBps,
          clausesHash,
          ZERO_ADDRESS,
          minDeposit
        )
      ).to.be.revertedWith("Party A cannot be Party B");
    });

    it("should revert with past expiry date", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          pastDate, // expiry in past
          penaltyBps,
          clausesHash,
          ZERO_ADDRESS,
          minDeposit
        )
      ).to.be.revertedWith("Expiry date must be in the future");
    });

    it("should revert with penalty over 100%", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          expiryDate,
          10001, // penalty > 10000 bps (100%)
          clausesHash,
          ZERO_ADDRESS,
          minDeposit
        )
      ).to.be.revertedWith("Penalty must be 10000 bps or less");
    });

    it("should revert with zero min deposit", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          expiryDate,
          penaltyBps,
          clausesHash,
          ZERO_ADDRESS,
          0 // minDeposit = 0
        )
      ).to.be.revertedWith("Minimum deposit must be greater than 0");
    });

    it("should revert with EOA as arbitrator", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          expiryDate,
          penaltyBps,
          clausesHash,
          partyB.address, // EOA as arbitrator
          minDeposit
        )
      ).to.be.revertedWith("Arbitrator must be a contract");
    });
  });

 
});