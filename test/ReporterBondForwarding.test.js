import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

describe('Reporter bond forwarding', function () {
  let landlord, tenant, reporter, other;
  let arbitrationService, factory, rent;
  let AcceptingReceiver, RejectingReceiver;

  beforeEach(async function () {
    [landlord, tenant, reporter, other] = await ethers.getSigners();

    const ArbitrationServiceFactory = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationServiceFactory.deploy();
    await arbitrationService.waitForDeployment();

    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // deploy a price feed so factory can create rent contracts
    const MockPriceFeed = await ethers.getContractFactory('MockPriceFeed');
    const mockPrice = await MockPriceFeed.deploy(2000);
    await mockPrice.waitForDeployment();

    // configure factory defaults so created rent contracts receive arbitrationService
    await factory.setDefaultArbitrationService(arbitrationService.target, 0);

    // create a rent contract via factory (landlord creates)
    const tx = await factory.connect(landlord).createRentContract(tenant.address, ethers.parseEther('0.5'), mockPrice.target, 0);
    const receipt = await tx.wait();
    const evt = receipt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
    const deployedAddr = evt.args.contractAddress;
    rent = await ethers.getContractAt('TemplateRentContract', deployedAddr);

    // helper receiver contracts
    const MockAccept = await ethers.getContractFactory('AcceptingReceiver');
    AcceptingReceiver = await MockAccept.deploy();
    await AcceptingReceiver.waitForDeployment();

    const MockReject = await ethers.getContractFactory('RejectingReceiver');
    RejectingReceiver = await MockReject.deploy();
    await RejectingReceiver.waitForDeployment();
  });

  it('forwards forfeited bond to arbitration owner EOA', async function () {
    const bond = ethers.parseEther('0.1');

    // landlord (a party) reports a dispute and attaches a bond
  const evDigest = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
  const tx = await rent.connect(landlord).reportDispute(0, ethers.parseEther('0.01'), evDigest, { value: bond });
    const rcpt = await tx.wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    const caseId = evt.args.caseId;

    // owner of arbitrationService is the landlord signer (deployer in beforeEach)
    const arbOwnerSigner = landlord;
    // call applyResolutionToTarget as owner to trigger forwarding (reject -> forfeit)
    await arbitrationService.connect(arbOwnerSigner).applyResolutionToTarget(rent.target ?? rent.address, caseId, false, 0, arbOwnerSigner.address);

    const bondAfter = await rent.getDisputeBond(caseId);
    expect(bondAfter).to.equal(0);
  });

  it('falls back to withdrawable when recipient rejects', async function () {
    const bond = ethers.parseEther('0.05');

    // tenant (a party) reports a dispute and attaches a bond
  const evDigest = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
  const tx = await rent.connect(tenant).reportDispute(0, ethers.parseEther('0.01'), evDigest, { value: bond });
    const rcpt = await tx.wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    const caseId = evt.args.caseId;

  // transfer arbitration service ownership to the rejecting contract address (handle ethers v6/v5)
  const rejectAddr = RejectingReceiver.target ?? RejectingReceiver.address;
  await arbitrationService.connect(landlord).transferOwnership(rejectAddr);

  const arbOwner = await arbitrationService.owner();
  expect(arbOwner).to.equal(rejectAddr);

  // Execute the transaction to perform the resolution via the rejecting helper contract
  const svcAddr = arbitrationService.target ?? arbitrationService.address;
  const tgtAddr = rent.target ?? rent.address;
  const txRes = await RejectingReceiver.callApplyResolution(svcAddr, tgtAddr, caseId, false, 0, rejectAddr);
  // callApplyResolution returns (bool) but when invoked via ethers it yields a tx; wait for it
  try {
    await txRes.wait();
  } catch (e) {
    // ignore any revert from the external call — we only care about resulting state on the rent contract
  }

  const bondAfter = await rent.getDisputeBond(caseId);
  expect(bondAfter.toString()).to.equal('0');

  const withdrawable = await rent.withdrawable(rejectAddr);
  // Compare as strings to avoid BigNumber/BigInt type mismatches across ethers versions
  expect(withdrawable.toString()).to.equal(bond.toString());
  });
});
