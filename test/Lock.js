import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

describe("ContractFactory + TemplateRentContract", function () {
  let landlord, tenant, other;
  let mockPriceFeed, factory, rentContract;

  beforeEach(async function () {
    [landlord, tenant, other] = await ethers.getSigners();

    // Deploy MockPriceFeed
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockPriceFeed = await MockPriceFeed.deploy(2000); // Price USD/ETH
    await mockPriceFeed.waitForDeployment();

    // Deploy the Factory
    const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // Create new Rent Contract from Factory
    const tx = await factory.connect(landlord).createRentContract(
      tenant.address,
      100, // rentAmount USD
      mockPriceFeed.target
    );
    const receipt = await tx.wait();

    // Parse RentContractCreated event correctly
    const event = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "RentContractCreated");

    if (!event) throw new Error("RentContractCreated event not found");

    const rentAddress = event.args.contractAddress;

    // Attach TemplateRentContract to the deployed address
    const TemplateRentContract = await ethers.getContractFactory("TemplateRentContract");
    rentContract = TemplateRentContract.attach(rentAddress);
  });

  it("should set correct landlord and tenant", async function () {
    expect(await rentContract.landlord()).to.equal(landlord.address);
    expect(await rentContract.tenant()).to.equal(tenant.address);
  });

  it("should allow tenant to pay rent in ETH", async function () {
    const ethAmount = await rentContract.getRentInEth();
    await rentContract.connect(tenant).payRentInEth({ value: ethAmount });
    expect(await rentContract.rentPaid()).to.be.true;
  });

  it("should not allow non-tenant to pay rent", async function () {
    const ethAmount = await rentContract.getRentInEth();
    await expect(
      rentContract.connect(other).payRentInEth({ value: ethAmount })
    ).to.be.revertedWith("Only tenant can pay");
  });

  it("should return correct price from MockPriceFeed", async function () {
    const price = await rentContract.checkRentPrice();
    expect(price).to.equal(2000);
  });

  it("should allow updating price in MockPriceFeed", async function () {
    await mockPriceFeed.setPrice(2500);
    const price = await rentContract.checkRentPrice();
    expect(price).to.equal(2500);
  });

  it("should calculate rent in ETH correctly", async function () {
    const ethAmount = await rentContract.getRentInEth();
    expect(ethAmount).to.be.above(0);
  });

  it("should apply late fee if paid after due date", async function () {
    const now = Math.floor(Date.now() / 1000);
    await rentContract.connect(landlord).setDueDate(now - 10); // עבר התאריך

    const ethAmount = await rentContract.getRentInEth();
    const lateFeePercent = await rentContract.lateFeePercent();

    // חישוב סכום כולל דמי פיגורים
    const totalDue = (ethAmount * (lateFeePercent + 100n)) / 100n;

    await rentContract.connect(tenant).payRentWithLateFee({ value: totalDue });
    expect(await rentContract.rentPaid()).to.be.true;
  });

  it("should not apply late fee if paid before due date", async function () {
    const now = Math.floor(Date.now() / 1000);
    await rentContract.connect(landlord).setDueDate(now + 1000); // לפני התאריך

    const ethAmount = await rentContract.getRentInEth();
    await rentContract.connect(tenant).payRentWithLateFee({ value: ethAmount });
    expect(await rentContract.rentPaid()).to.be.true;
  });
});
