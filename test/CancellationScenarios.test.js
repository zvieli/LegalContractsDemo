import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

// Hardhat default accounts (from user list)
const ADDR = {
  landlord: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  tenant:   "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  a:        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  b:        "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
};

async function pickSigner(address) {
  const all = await ethers.getSigners();
  const found = all.find((s) => s.address.toLowerCase() === address.toLowerCase());
  if (!found) throw new Error(`Signer ${address} not found`);
  return found;
}

describe("TemplateRentContract - Cancellation Scenarios (explicit addresses)", function () {
  let rentContract, mockPriceFeed;
  let landlord, tenant, A, B;

  beforeEach(async function () {
    landlord = await pickSigner(ADDR.landlord);
    tenant = await pickSigner(ADDR.tenant);
    A = await pickSigner(ADDR.a);
    B = await pickSigner(ADDR.b);

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockPriceFeed = await MockPriceFeed.deploy(2000);
    await mockPriceFeed.waitForDeployment();

    const Rent = await ethers.getContractFactory("TemplateRentContract");
    rentContract = await Rent.deploy(
      landlord.address,
      tenant.address,
      ethers.parseEther("0.5"),
      mockPriceFeed.target
    );
    await rentContract.waitForDeployment();
  });

  it("default immediate cancellation (no policy) via landlord", async function () {
    await expect(rentContract.connect(landlord).cancelContract())
      .to.emit(rentContract, "ContractCancelled")
      .withArgs(landlord.address);
    expect(await rentContract.active()).to.equal(false);
  });

  it("mutual cancel with notice > 0: approve finalizes immediately", async function () {
    await expect(rentContract.connect(landlord).setCancellationPolicy(3600, 0, true))
      .to.emit(rentContract, "CancellationPolicyUpdated");

    await expect(rentContract.connect(landlord).cancelContract())
      .to.emit(rentContract, "CancellationInitiated");

    expect(await rentContract.active()).to.equal(true);

    await expect(rentContract.connect(tenant).approveCancellation())
      .to.emit(rentContract, "CancellationApproved")
      .and.to.emit(rentContract, "ContractCancelled")
      .and.to.emit(rentContract, "CancellationFinalized");

    expect(await rentContract.active()).to.equal(false);
  });

  it("unilateral with notice (no fee): cannot finalize early; finalizes after time", async function () {
    await rentContract.connect(landlord).setCancellationPolicy(3600, 0, false);

    await expect(rentContract.connect(tenant).initiateCancellation())
      .to.emit(rentContract, "CancellationInitiated");

    await expect(rentContract.connect(tenant).finalizeCancellation())
      .to.be.revertedWith("Notice period not elapsed");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(rentContract.connect(tenant).finalizeCancellation())
      .to.emit(rentContract, "ContractCancelled")
      .and.to.emit(rentContract, "CancellationFinalized");

    expect(await rentContract.active()).to.equal(false);
  });

  it("unilateral with notice + fee: must send correct fee to finalize", async function () {
    await rentContract.connect(landlord).setCancellationPolicy(3600, 1000, false); // 10%

    await expect(rentContract.connect(tenant).initiateCancellation())
      .to.emit(rentContract, "CancellationInitiated");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    const rentInEth = await rentContract.getRentInEth();
    const expectedFee = (rentInEth * 1000n) / 10000n;

    if (expectedFee > 0n) {
      await expect(rentContract.connect(tenant).finalizeCancellation({ value: expectedFee - 1n }))
        .to.be.revertedWith("Insufficient fee");
    }

    await expect(rentContract.connect(tenant).finalizeCancellation({ value: expectedFee }))
      .to.emit(rentContract, "EarlyTerminationFeePaid")
      .withArgs(tenant.address, expectedFee, landlord.address)
      .and.to.emit(rentContract, "ContractCancelled")
      .and.to.emit(rentContract, "CancellationFinalized");

    expect(await rentContract.active()).to.equal(false);
  });

  it("guards: approve/finalize without request revert; subsequent approve after finalize is blocked", async function () {
    await expect(rentContract.connect(tenant).approveCancellation())
      .to.be.revertedWith("No cancellation requested");

    await expect(rentContract.connect(tenant).finalizeCancellation())
      .to.be.revertedWith("No cancellation requested");

    await rentContract.connect(landlord).setCancellationPolicy(0, 0, true);
    await rentContract.connect(landlord).initiateCancellation();

    await expect(rentContract.connect(tenant).approveCancellation())
      .to.emit(rentContract, "CancellationApproved");
    // After approval under mutual policy, contract is finalized and inactive
    expect(await rentContract.active()).to.equal(false);
    await expect(rentContract.connect(tenant).approveCancellation())
      .to.be.revertedWith("Contract is not active");
  });
});
