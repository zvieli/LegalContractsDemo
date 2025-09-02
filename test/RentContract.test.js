// test/RentContract.test.js - הגרסה המתוקנת
import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("TemplateRentContract", function () {
  let RentContract, rentContract;
  let landlord, tenant, other;
  let mockPriceFeed;
  let token;

beforeEach(async function () {
  [landlord, tenant, other] = await ethers.getSigners();
  
  // העברת יותר ETH ל-tenant כדי לכסות גם gas costs
  await landlord.sendTransaction({
    to: tenant.address,
    value: ethers.parseEther("100.0") // יותר ETH
  });
  
  // Deploy MockPriceFeed
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  mockPriceFeed = await MockPriceFeed.deploy(2000);
  await mockPriceFeed.waitForDeployment();

  // Deploy MockERC20
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  token = await MockERC20.deploy("TestToken", "TTK", ethers.parseUnits("1000", 18));
  await token.waitForDeployment();

  // Deploy RentContract
  RentContract = await ethers.getContractFactory("TemplateRentContract");
  rentContract = await RentContract.deploy(
    landlord.address,
    tenant.address,
    ethers.parseEther("0.5"), // שכירות קטנה יותר לבדיקות
    mockPriceFeed.target
  );
  await rentContract.waitForDeployment();

  // Mint & Approve tokens for tenant
  await token.transfer(tenant.address, ethers.parseUnits("500", 18));
  await token.connect(tenant).approve(rentContract.target, ethers.parseUnits("500", 18));
});

  // Helper function for anyValue
  const anyValue = () => true;

  describe("Basic Functionality", function () {
    it("should deploy with correct initial values", async function () {
      expect(await rentContract.landlord()).to.equal(landlord.address);
      expect(await rentContract.tenant()).to.equal(tenant.address);
      expect(await rentContract.rentAmount()).to.equal(ethers.parseEther("0.5"));
      expect(await rentContract.active()).to.be.true;
    });
  });

  describe("Rent Payment", function () {
    it("should allow tenant to pay rent", async function () {
      const rentAmount = ethers.parseEther("0.5");
      
      await expect(rentContract.connect(tenant).payRent(rentAmount))
        .to.emit(rentContract, "RentPaid")
        .withArgs(tenant.address, rentAmount, false, ethers.ZeroAddress);

      expect(await rentContract.rentPaid()).to.be.true;
      expect(await rentContract.totalPaid()).to.equal(rentAmount);
    });
  });

describe("ETH Payment", function () {
  it("should allow tenant to pay rent in ETH", async function () {
    const rentInEth = await rentContract.getRentInEth();
    console.log("Rent in ETH:", ethers.formatEther(rentInEth));
    
    // בדיקה שהסכום סביר (אמור להיות around 0.00025 ETH for $0.5 rent at $2000/ETH)
    expect(parseFloat(ethers.formatEther(rentInEth))).to.be.lessThan(0.001);
    
    const tenantBalance = await ethers.provider.getBalance(tenant.address);
    expect(tenantBalance).to.be.greaterThan(rentInEth);

    await expect(rentContract.connect(tenant).payRentInEth({ value: rentInEth }))
      .to.emit(rentContract, "RentPaid")
      .withArgs(tenant.address, rentInEth, false, ethers.ZeroAddress);

    expect(await rentContract.rentPaid()).to.be.true;
  });

  it("should calculate correct ETH amount", async function () {
    // rentAmount = 0.5 USD
    // price = 2000 USD/ETH 
    // expected: 0.5 / 2000 = 0.00025 ETH
    const expectedEth = ethers.parseEther("0.5") / 2000n;
    const actualEth = await rentContract.getRentInEth();
    
    expect(actualEth).to.be.closeTo(expectedEth, expectedEth / 100n); // within 1%
  });
});

  describe("Token Payment", function () {
    it("should allow tenant to pay rent with ERC20 token", async function () {
      const initialLandlordBalance = await token.balanceOf(landlord.address);
      const rentAmount = ethers.parseUnits("100", 18);

      await expect(rentContract.connect(tenant).payRentWithToken(token.target, rentAmount))
        .to.emit(rentContract, "RentPaid")
        .withArgs(tenant.address, rentAmount, false, token.target);

      expect(await token.balanceOf(landlord.address)).to.equal(initialLandlordBalance + rentAmount);
      expect(await rentContract.tokenPaid(token.target)).to.equal(rentAmount);
    });

    it("should revert when tenant tries to pay with ERC20 without approve", async function () {
      // revoke approval
      await token.connect(tenant).approve(rentContract.target, 0);

      const rentAmount = ethers.parseUnits("100", 18);

      await expect(rentContract.connect(tenant).payRentWithToken(token.target, rentAmount))
        .to.be.reverted; // SafeERC20 will revert if transferFrom fails
    });
  });

  describe("Rent Signing", function () {
    it("should allow tenant to sign rent with valid signature", async function () {
      // יצירת החתימה כמו ב-contract
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256"],
        [rentContract.target, await rentContract.rentAmount(), await rentContract.dueDate()]
      );
      
      const signature = await tenant.signMessage(ethers.getBytes(messageHash));

      await expect(rentContract.connect(tenant).signRent(signature))
        .to.emit(rentContract, "RentSigned")
        .withArgs(tenant.address, anyValue);

      expect(await rentContract.rentSigned()).to.be.true;
    });

    it("should revert when invalid signature provided", async function () {
      const invalidMessage = ethers.solidityPackedKeccak256(
        ["string"],
        ["Invalid message"]
      );
      const invalidSignature = await other.signMessage(ethers.getBytes(invalidMessage));
      
      await expect(rentContract.connect(tenant).signRent(invalidSignature))
        .to.be.revertedWith("Invalid signature");
    });
  });

  describe("Admin Functions", function () {
    it("should allow landlord to update late fee", async function () {
      const newFee = 10; // 10%
      
      await expect(rentContract.connect(landlord).updateLateFee(newFee))
        .to.emit(rentContract, "LateFeeUpdated")
        .withArgs(newFee);

      expect(await rentContract.lateFeePercent()).to.equal(newFee);
    });
  });

  describe("Contract Cancellation", function () {
    it("should allow landlord to cancel contract", async function () {
      await expect(rentContract.connect(landlord).cancelContract())
        .to.emit(rentContract, "ContractCancelled")
        .withArgs(landlord.address);

      expect(await rentContract.active()).to.be.false;
    });

    it("should allow tenant to cancel contract", async function () {
      await expect(rentContract.connect(tenant).cancelContract())
        .to.emit(rentContract, "ContractCancelled")
        .withArgs(tenant.address);

      expect(await rentContract.active()).to.be.false;
    });

    it("should prevent payments after cancellation", async function () {
      await rentContract.connect(landlord).cancelContract();

      await expect(rentContract.connect(tenant).payRent(ethers.parseEther("0.5")))
        .to.be.revertedWith("Contract is not active");
    });
  });
});