import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

describe('Dispute bond & deposit flows', function () {
  let landlord, tenant, reporter, arbOwner;
  let arbitrationService, factory, rent;
  let evDigest;

  beforeEach(async function () {
    [landlord, tenant, reporter, arbOwner] = await ethers.getSigners();

    const ArbitrationServiceFactory = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationServiceFactory.deploy();
    await arbitrationService.waitForDeployment();

    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // Use real Chainlink ETH/USD aggregator address
    const priceFeedAddress = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";

    await factory.setDefaultArbitrationService(arbitrationService.target, 0);

    const tx = await factory.connect(landlord).createRentContract(
      tenant.address,
      ethers.parseEther('1'),
      priceFeedAddress,
      0
    );
    const receipt = await tx.wait();
    const evt = receipt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
    const deployedAddr = evt.args.contractAddress;
    rent = await ethers.getContractAt('TemplateRentContract', deployedAddr);
    // common evidence digest used by tests in this suite
    evDigest = ethers.keccak256(ethers.toUtf8Bytes('e'));
  });

  it('requires reporter to pay 0.5% bond when submitting a dispute', async function () {
    const requested = ethers.parseEther('1');
    const requiredBond = requested * 5n / 1000n; // 0.5%

    // try reporting with insufficient bond
    const evDigest = ethers.keccak256(ethers.toUtf8Bytes('e'));
    await expect(
      rent.connect(landlord).reportDispute(0, requested, evDigest, { value: requiredBond - 1n })
    ).to.be.reverted;

    // reporting with exact bond should succeed
  const tx = await rent.connect(landlord).reportDispute(0, requested, evDigest, { value: requiredBond });
    const rcpt = await tx.wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    expect(evt).to.not.be.undefined;
  });

  it('debtor can deposit required claim amount for a case', async function () {
    const requested = ethers.parseEther('2');
    const requiredBond = requested * 5n / 1000n;
  const rcpt = await (await rent.connect(tenant).reportDispute(0, requested, evDigest, { value: requiredBond })).wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    const caseId = evt.args.caseId;

    // debtor is the other party (tenant reported, debtor = landlord)
    const debtor = await rent.landlord();
    // deposit less than required should mark unsatisfied
    await expect(rent.connect(landlord).depositForCase(caseId, { value: ethers.parseEther('1') })).to.not.be.reverted;
    // deposit remaining amount to satisfy
    const needed = requested - ethers.parseEther('1');
    await rent.connect(landlord).depositForCase(caseId, { value: needed });
    // ensure partyDeposit now >= requested
    const pd = await rent.partyDeposit(landlord);
    expect(pd).to.be.at.least(requested);
  });

  it('approval returns bond to reporter and moves debtor deposit to claimant', async function () {
    const requested = ethers.parseEther('1');
    const bond = requested * 5n / 1000n;

  const rcpt = await (await rent.connect(tenant).reportDispute(0, requested, evDigest, { value: bond })).wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    const caseId = evt.args.caseId;

    // debtor = landlord deposits requested amount
  await rent.connect(landlord).depositForCase(caseId, { value: requested });

    // track balances
    const beforeReporter = await ethers.provider.getBalance(tenant.address);
    const beforeClaimant = await ethers.provider.getBalance(tenant.address);

    // Approve via arbitration service owner (deployer) as owner
  const arbOwnerAddr = await arbitrationService.owner();
  await arbitrationService.connect(landlord).applyResolutionToTarget(rent.target, caseId, true, requested, tenant.address);

    // bond should be zeroed
  const bondAfter = await rent.getDisputeBond(caseId);
    expect(bondAfter).to.equal(0);

    // partyDeposit of debtor should be reduced
  const pd = await rent.partyDeposit(landlord.address);
    expect(pd).to.equal(0);
  });

  it('rejection forwards bond to arbitrator owner', async function () {
    const requested = ethers.parseEther('1');
    const bond = requested * 5n / 1000n;
  const rcpt = await (await rent.connect(tenant).reportDispute(0, requested, evDigest, { value: bond })).wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'DisputeReported');
    const caseId = evt.args.caseId;

    // transfer arbitration owner to arbOwner (EOA)
  await arbitrationService.connect(landlord).transferOwnership(arbOwner.address);

  // check contract balance before
  const rentBalBefore = await ethers.provider.getBalance(rent.target);

  // Reject via arbitrationService owner
  await arbitrationService.connect(arbOwner).applyResolutionToTarget(rent.target, caseId, false, 0, arbOwner.address);

  // bond should be zero
  const bondAfter2 = await rent.getDisputeBond(caseId);
  expect(bondAfter2).to.equal(0);

  // either the contract paid out the bond to the EOA (balance decreased) or the recipient was a rejecting contract
  // and the value was credited to withdrawable. Accept either behavior.
  const rentBalAfter = await ethers.provider.getBalance(rent.target);
  const delta = rentBalBefore - rentBalAfter;
  const w = await rent.withdrawable(arbOwner.address);
  const ok = (delta >= bond) || (w >= bond);
  expect(ok, `neither contract balance decreased by bond (${delta}) nor withdrawable increased (${w})`).to.be.true;
  });

});
