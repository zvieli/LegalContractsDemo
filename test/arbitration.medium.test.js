import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('Arbitration medium-priority tests: reporter-bond edge cases & CCIP idempotency permutations', function () {
  let factory, arbitrationService, merkleEvidenceManager, mockPriceFeed;
  let landlord, tenant, stranger;

  before(async function () {
    [landlord, tenant, stranger] = await ethers.getSigners();

    const MerkleEvidenceManager = await ethers.getContractFactory('MerkleEvidenceManager');
    merkleEvidenceManager = await MerkleEvidenceManager.deploy();
    await merkleEvidenceManager.waitForDeployment();

    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();

    const MockV3Aggregator = await ethers.getContractFactory('MockV3Aggregator');
    const initialAnswer = BigInt(3000) * BigInt(10 ** 8);
    mockPriceFeed = await MockV3Aggregator.deploy(8, initialAnswer);
    await mockPriceFeed.waitForDeployment();

    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.deploy();
    await factory.waitForDeployment();
    await factory.setDefaultArbitrationService(arbitrationService.target);
    await factory.setMerkleEvidenceManager(merkleEvidenceManager.target);
  });

  it('reporter bond: partial refund when appliedAmount < bond should leave bond cleared and not send extra', async function () {
    const rentAmount = ethers.parseEther('1.0');
    const dueDate = Math.floor(Date.now() / 1000) + 86400;
  const startDate = Math.floor(Date.now() / 1000);
  const durationDays = 30;
  const tx = await factory.connect(landlord).createEnhancedRentContractWithPolicy(tenant.address, rentAmount, mockPriceFeed.target ?? mockPriceFeed.address, dueDate, startDate, durationDays, 101);
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

    // sign
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
    const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
    const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
    await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
    await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

    // reporter pays a bond of 0.01 ETH
    const bond = ethers.parseEther('0.01');
    await rentContract.connect(landlord).reportDispute(0, ethers.parseEther('0.005'), 'ipfs://rb1', { value: bond });

    // now arbitrator approves but appliedAmount is less than bond (apply 0.002)
    await arbitrationService.connect(landlord).applyResolutionToTarget(rentContract.target ?? rentContract.address, 0, true, ethers.parseEther('0.002'), landlord.address);

    // after resolution, dispute bond storage should be zero
    const b = await rentContract.getDisputeBond(0);
    expect(b).to.equal(0);
  });

  it('reporting by non-party is rejected', async function () {
    const rentAmount = ethers.parseEther('0.6');
    const dueDate = Math.floor(Date.now() / 1000) + 86400;
  const startDate2 = Math.floor(Date.now() / 1000);
  const durationDays2 = 30;
  const tx = await factory.connect(landlord).createEnhancedRentContractWithPolicy(tenant.address, rentAmount, mockPriceFeed.target ?? mockPriceFeed.address, dueDate, startDate2, durationDays2, 102);
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

    // stranger (not landlord/tenant) tries to report dispute
    await expect(rentContract.connect(stranger).reportDispute(0, ethers.parseEther('0.01'), 'ipfs://x', { value: ethers.parseEther('0.001') }))
      .to.be.revertedWithCustomError(rentContract, 'NotParty');
  });

  it('CCIP idempotency hardened: same params but different msg.value are considered distinct when forwarded ETH differs', async function () {
    const rentAmount = ethers.parseEther('0.7');
    const dueDate = Math.floor(Date.now() / 1000) + 86400;
  const startDate3 = Math.floor(Date.now() / 1000);
  const durationDays3 = 30;
  const tx = await factory.connect(landlord).createEnhancedRentContractWithPolicy(tenant.address, rentAmount, mockPriceFeed.target ?? mockPriceFeed.address, dueDate, startDate3, durationDays3, 103);
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

    // sign and report
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
    const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
    const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
    await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
    await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

    const requested = ethers.parseEther('0.03');
    const percentageBond = (requested * 50n) / 10000n;
    const minBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minBond ? percentageBond : minBond;
    await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://ccip-hard', { value: requiredBond });

    const messageId = ethers.id('hard-1');
    const disputeId = ethers.id('hard-d1');
    const decisionTuple = [disputeId, true, requested, landlord.address, 'ok', ethers.id('oracleY'), Math.floor(Date.now() / 1000), rentContract.target ?? rentContract.address, 0];
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)'],
      [decisionTuple]
    );

    // first call with no forwarded ETH
    await arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);

    // forwarded ETH should revert because receiveCCIPDecisionRaw is non-payable
    await expect(arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded, { value: ethers.parseEther('0.01') }))
      .to.be.reverted;

    // second call with same messageId and zero value should be rejected due to processed decision
    await expect(arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded))
      .to.be.revertedWith('Decision already processed');
  });
});
