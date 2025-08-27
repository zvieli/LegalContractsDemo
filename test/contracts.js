import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";
import { splitSignature } from "ethers/lib/utils.js";

describe("Contracts Suite", function () {
  let landlord, tenant, other, partyA, partyB;
  let mockPriceFeed, factory, rentContract, ndaContract;

  beforeEach(async function () {
    [landlord, tenant, other, partyA, partyB] = await ethers.getSigners();

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockPriceFeed = await MockPriceFeed.deploy(2000);
    await mockPriceFeed.waitForDeployment();

    const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    const tx = await factory.connect(landlord).createRentContract(
      await tenant.getAddress(),
      100,
      await mockPriceFeed.getAddress()
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "RentContractCreated");

    const rentAddress = event.args.contractAddress;
    const TemplateRentContract = await ethers.getContractFactory("TemplateRentContract");
    rentContract = TemplateRentContract.attach(rentAddress);

    const NDATemplate = await ethers.getContractFactory("NDATemplate");
    ndaContract = await NDATemplate.deploy(
      await partyA.getAddress(),
      await partyB.getAddress()
    );
    await ndaContract.waitForDeployment();
  });

  // --------------------- TemplateRentContract tests ---------------------
  it("should set correct landlord and tenant", async function () {
    expect(await rentContract.landlord()).to.equal(await landlord.getAddress());
    expect(await rentContract.tenant()).to.equal(await tenant.getAddress());
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
    expect(ethAmount).to.be.above(0n);
  });

  it("should apply late fee if paid after due date", async function () {
    const now = Math.floor(Date.now() / 1000);
    await rentContract.connect(landlord).setDueDate(now - 10);

    const ethAmount = await rentContract.getRentInEth();
    const lateFeePercent = await rentContract.lateFeePercent();
    const totalDue = (ethAmount * (lateFeePercent + 100n)) / 100n;

    await rentContract.connect(tenant).payRentWithLateFee({ value: totalDue });
    expect(await rentContract.rentPaid()).to.be.true;
  });

  it("should not apply late fee if paid before due date", async function () {
    const now = Math.floor(Date.now() / 1000);
    await rentContract.connect(landlord).setDueDate(now + 1000);

    const ethAmount = await rentContract.getRentInEth();
    await rentContract.connect(tenant).payRentWithLateFee({ value: ethAmount });
    expect(await rentContract.rentPaid()).to.be.true;
  });

  // --------------------- NDATemplate EIP712 tests ---------------------




});

