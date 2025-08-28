import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";


describe("ContractFactory", function () {
  let factory, landlord, tenant, partyA, partyB;
  let mockPriceFeed;

beforeEach(async function () {
  [landlord, tenant, partyA, partyB] = await ethers.getSigners();

  // פריסה של MockPriceFeed
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  mockPriceFeed = await MockPriceFeed.deploy(2000);
  await mockPriceFeed.waitForDeployment(); // ← כאן השתמש ב-deployed

  // פריסה של ה־Factory
  const Factory = await ethers.getContractFactory("ContractFactory");
  factory = await Factory.deploy();
  await factory.waitForDeployment(); // ← כאן גם
});


  describe("createRentContract", function () {
    it("should deploy a rent contract successfully", async function () {
      const tx = await factory.connect(landlord).createRentContract(
        tenant.address,
        100,
        mockPriceFeed.target // השתמש בכתובת ישירה
      );
      const receipt = await tx.wait();

      // מציאת האירוע RentContractCreated
      const event = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "RentContractCreated");

      expect(event).to.not.be.undefined;
      expect(event.args.landlord).to.equal(landlord.address);
      expect(event.args.tenant).to.equal(tenant.address);

      // בדיקה שהחוזה נוסף לרשימות
      const allContracts = await factory.getAllContracts();
      expect(allContracts).to.include(event.args.contractAddress);

      const creatorContracts = await factory.getContractsByCreator(landlord.address);
      expect(creatorContracts).to.include(event.args.contractAddress);
    });
  });

  describe("createNDA", function () {
    it("should deploy NDA successfully", async function () {
      const expiry = Math.floor(Date.now() / 1000) + 3600; // שעה מהיום
      const penaltyBps = 500; // 5%
      const clauseHash = ethers.keccak256(ethers.toUtf8Bytes("Some NDA clause"));
      const minDeposit = ethers.parseEther("0.1");

      const tx = await factory.connect(partyA).createNDA(
        partyB.address,
        expiry,
        penaltyBps,
        clauseHash,
        partyA.address, // כתובת חוקית עבור arbitrator
        minDeposit
      );
      const receipt = await tx.wait();

      // מציאת האירוע NDACreated
      const event = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "NDACreated");

      expect(event).to.not.be.undefined;
      expect(event.args.partyA).to.equal(partyA.address);
      expect(event.args.partyB).to.equal(partyB.address);

      // בדיקה שהחוזה נוסף לרשימות
      const allContracts = await factory.getAllContracts();
      expect(allContracts).to.include(event.args.contractAddress);

      const creatorContracts = await factory.getContractsByCreator(partyA.address);
      expect(creatorContracts).to.include(event.args.contractAddress);
    });
  });
});
