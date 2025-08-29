import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;
import "@nomicfoundation/hardhat-chai-matchers";


describe("TemplateRentContract", function () {
  let RentContract, rentContract;
  let landlord, tenant, other;
  let token;

  beforeEach(async function () {
    [landlord, tenant, other] = await ethers.getSigners();

    // Deploy MockERC20 (כמו שאמרת - אתה כבר תוסיף את החוזה)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("TestToken", "TTK", ethers.parseUnits("1000", 18));
    await token.waitForDeployment();

    // Deploy RentContract
    RentContract = await ethers.getContractFactory("TemplateRentContract");
rentContract = await RentContract.deploy(
  landlord.getAddress(),
  tenant.getAddress(),
  ethers.parseEther("0.5"),
  mockPriceFeed.target
);
    await rentContract.waitForDeployment();

    // Mint & Approve tokens for tenant
    await token.transfer(tenant.address, ethers.parseUnits("500", 18));
    await token.connect(tenant).approve(rentContract.target, ethers.parseUnits("500", 18));
  });

  // ============= בדיקות קיימות מתוקנות =============
  it("should allow tenant to sign rent with valid signature", async function () {
    const message = "SignRentAgreement";
    const signature = await tenant.signMessage(ethers.toUtf8Bytes(message));

    await expect(rentContract.connect(tenant).signRent(signature))
      .to.emit(rentContract, "RentSigned")
      .withArgs(tenant.address, anyValue);

    // בדיקה נוספת – אי אפשר לחתום שוב
    await expect(rentContract.connect(tenant).signRent(signature))
      .to.be.revertedWith("AlreadySigned");
  });

  it("should allow tenant to pay rent with ERC20 token", async function () {
    const rentAmount = ethers.parseUnits("100", 18);

    await expect(rentContract.connect(tenant).payRent(rentAmount))
      .to.emit(rentContract, "RentPaid")
      .withArgs(tenant.address, rentAmount);

    expect(await token.balanceOf(landlord.address)).to.equal(rentAmount);
  });

  // ============= בדיקות חדשות =============

  it("should only allow landlord to update late fee", async function () {
    const newFee = ethers.parseUnits("10", 18);

    // landlord יכול
    await expect(rentContract.connect(landlord).updateLateFee(newFee))
      .to.emit(rentContract, "LateFeeUpdated")
      .withArgs(newFee);

    // אחרים לא יכולים
    await expect(rentContract.connect(tenant).updateLateFee(newFee))
      .to.be.revertedWith("OnlyLandlord");

    await expect(rentContract.connect(other).updateLateFee(newFee))
      .to.be.revertedWith("OnlyLandlord");
  });

  it("should only allow landlord to set due date", async function () {
    const newDueDate = Math.floor(Date.now() / 1000) + 3600; // שעה מהיום

    await expect(rentContract.connect(landlord).setDueDate(newDueDate))
      .to.emit(rentContract, "DueDateUpdated")
      .withArgs(newDueDate);

    await expect(rentContract.connect(tenant).setDueDate(newDueDate))
      .to.be.revertedWith("OnlyLandlord");
  });

  it("should not allow double payment after contract is cancelled", async function () {
    const rentAmount = ethers.parseUnits("50", 18);

    // landlord מבטל
    await rentContract.connect(landlord).cancelContract();

    // tenant מנסה לשלם
    await expect(rentContract.connect(tenant).payRent(rentAmount))
      .to.be.revertedWith("ContractCancelled");
  });
});

