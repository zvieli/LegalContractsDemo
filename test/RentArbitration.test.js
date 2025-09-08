import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("TemplateRentContract Arbitration & Disputes", function() {
  let landlord, tenant, other;
  let mockPriceFeed;
  let rent;

  beforeEach(async () => {
    [landlord, tenant, other] = await ethers.getSigners();
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockPriceFeed = await MockPriceFeed.deploy(2000);
    await mockPriceFeed.waitForDeployment();
    const Factory = await ethers.getContractFactory("ContractFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    const tx = await factory.connect(landlord).createRentContract(
          tenant.address,
          ethers.parseEther("0.5"),
          mockPriceFeed.target,
          0
    );
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
    rent = await ethers.getContractAt('TemplateRentContract', log.args.contractAddress);
    // Sign rent so depositSecurity is allowed
    const dueDate = await rent.dueDate();
    const rentAmount = await rent.rentAmount();
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rent.target };
    const types = { RENT: [ {name:'contractAddress',type:'address'},{name:'landlord',type:'address'},{name:'tenant',type:'address'},{name:'rentAmount',type:'uint256'},{name:'dueDate',type:'uint256'} ]};
    const value = { contractAddress: rent.target, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
    const sigL = await landlord.signTypedData(domain, types, value);
    await rent.connect(landlord).signRent(sigL);
    const sigT = await tenant.signTypedData(domain, types, value);
    await rent.connect(tenant).signRent(sigT);
  });

  it("configures arbitration", async () => {
    await expect(rent.connect(landlord).configureArbitration(other.address, ethers.parseEther("1")))
      .to.emit(rent, 'ArbitrationConfigured')
      .withArgs(other.address, ethers.parseEther("1"));
    expect(await rent.arbitrationConfigured()).to.be.true;
  });

  it("accepts security deposit and reports dispute", async () => {
    await rent.connect(landlord).configureArbitration(other.address, ethers.parseEther("1"));
    await expect(rent.connect(tenant).depositSecurity({ value: ethers.parseEther("1") }))
      .to.emit(rent, 'SecurityDepositPaid');
    expect(await rent.depositBalance()).to.equal(ethers.parseEther("1"));
    const tx = await rent.connect(landlord).reportDispute(0, ethers.parseEther("0.4"), ethers.keccak256(ethers.toUtf8Bytes("evidence")));
    const r = await tx.wait();
    const log = r.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    expect(log.args.disputeType).to.equal(0);
  });

  it("resolves dispute via arbitrator", async () => {
    await rent.connect(landlord).configureArbitration(other.address, ethers.parseEther("1"));
    await rent.connect(tenant).depositSecurity({ value: ethers.parseEther("1") });
    await rent.connect(landlord).reportDispute(0, ethers.parseEther("0.6"), ethers.keccak256(ethers.toUtf8Bytes("ev")));
    await expect(rent.connect(other).resolveDisputeFinal(0, true, ethers.parseEther("0.5"), landlord.address, 'damage', 'wall damage'))
      .to.emit(rent, 'DisputeResolved')
      .withArgs(0, true, ethers.parseEther("0.5"), landlord.address);
    const bal = await rent.depositBalance();
    expect(bal).to.equal(ethers.parseEther("0.5"));
  });
});
