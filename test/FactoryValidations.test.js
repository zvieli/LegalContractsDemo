const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("ContractFactory with Validations", function () {
  let factory;
  let landlord, tenant, partyA, partyB, other;
  // let mockPriceFeed;

  beforeEach(async function () {
    [landlord, tenant, partyA, partyB, other] = await ethers.getSigners();

  // No mock price feed, use Chainlink aggregator

    // Deploy Factory 
  const Factory = await ethers.getContractFactory("ContractFactory");
  factory = await Factory.deploy();
  await factory.waitForDeployment();
  });

  describe("createRentContract Validations", function () {
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

    it("should revert when landlord is also tenant", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          landlord.address,
          100,
          CHAINLINK_ETH_USD,
          0
        )
      ).to.be.revertedWithCustomError(factory, 'SameAddresses');
    });
        let priceFeed;
    it("should revert with zero rent amount", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          tenant.address,
          0,
          CHAINLINK_ETH_USD,
          0
        )
      ).to.be.revertedWithCustomError(factory, 'ZeroRentAmount');
    });

    it("should revert with zero price feed address", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          tenant.address,
          100,
          ZERO_ADDRESS,
          0
        )
      ).to.be.revertedWithCustomError(factory, 'ZeroPriceFeed');
    });

    it("should revert with EOA as price feed", async function () {
      await expect(
        factory.connect(landlord).createRentContract(
          tenant.address,
          100,
          tenant.address,
          0
        )
      ).to.be.revertedWithCustomError(factory, 'PriceFeedNotContract');
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
          ZERO_ADDRESS,
          expiryDate,
          penaltyBps,
          clausesHash,
          minDeposit
        )
      ).to.be.revertedWithCustomError(factory, 'ZeroPartyB');
    });

    it("should revert when partyA is also partyB", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyA.address,
          expiryDate,
          penaltyBps,
          clausesHash,
          minDeposit
        )
      ).to.be.revertedWithCustomError(factory, 'SameParties');
    });

    it("should revert with past expiry date", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          pastDate,
          penaltyBps,
          clausesHash,
          minDeposit
        )
      ).to.be.revertedWithCustomError(factory, 'ExpiryNotFuture');
    });

    it("should revert with penalty over 100%", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          expiryDate,
          10001,
          clausesHash,
          minDeposit
        )
      ).to.be.revertedWithCustomError(factory, 'PenaltyTooHigh');
    });

    it("should revert with zero min deposit", async function () {
      await expect(
        factory.connect(partyA).createNDA(
          partyB.address,
          expiryDate,
          penaltyBps,
          clausesHash,
          0
        )
      ).to.be.revertedWithCustomError(factory, 'MinDepositZero');
    });
  });
  });

 
