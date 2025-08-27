import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

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





async function signNDA(signer, contractAddress) {
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: "NDATemplate",
    version: "1",
    chainId: Number(network.chainId), 
    verifyingContract: contractAddress
  };

  const types = {
    NDA: [{ name: "contractAddress", type: "address" }]
  };

  const value = { contractAddress };

  const msgParams = JSON.stringify({
    domain,
    message: value,
    primaryType: "NDA",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      NDA: types.NDA
    }
  });

  return await signer.provider.send("eth_signTypedData_v4", [
    await signer.getAddress(),
    msgParams
  ]);
}


describe("NDATemplate EIP712 tests", function () {
  let partyA, partyB, other, ndaContract;

  beforeEach(async function () {
    [partyA, partyB, other] = await ethers.getSigners();

    const NDATemplate = await ethers.getContractFactory("NDATemplate");
    ndaContract = await NDATemplate.deploy(
      await partyA.getAddress(),
      await partyB.getAddress()
    );
    await ndaContract.waitForDeployment();
  });

  it("should set correct parties for NDA", async function () {
    expect(await ndaContract.partyA()).to.equal(await partyA.getAddress());
    expect(await ndaContract.partyB()).to.equal(await partyB.getAddress());
  });

  it("should calculate correct EIP712 hash", async function () {
    const hash = await ndaContract.hashMessage();
    expect(hash).to.be.a("string");
  });

  it("should allow partyA to sign NDA", async function () {
    const signature = await signNDA(partyA, ndaContract.target);
    await ndaContract.connect(partyA).signNDA(signature);

    expect(await ndaContract.signedByA()).to.be.true;
    expect(await ndaContract.signedByB()).to.be.false;
  });

  it("should allow partyB to sign NDA", async function () {
    const signature = await signNDA(partyB, ndaContract.target);
    await ndaContract.connect(partyB).signNDA(signature);

    expect(await ndaContract.signedByB()).to.be.true;
    expect(await ndaContract.signedByA()).to.be.false;
  });

  it("should revert on invalid signer", async function () {
    const signature = await signNDA(other, ndaContract.target);
    await expect(
      ndaContract.connect(other).signNDA(signature)
    ).to.be.revertedWith("Invalid signer");
  });

  it("should return true for isFullySigned after both sign", async function () {
    const sigA = await signNDA(partyA, ndaContract.target);
    const sigB = await signNDA(partyB, ndaContract.target);

    await ndaContract.connect(partyA).signNDA(sigA);
    await ndaContract.connect(partyB).signNDA(sigB);

    expect(await ndaContract.isFullySigned()).to.be.true;
  });
});




});

