import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('Arbitration CCIP edge-cases', function () {
  let factory, arbitrationService, merkleEvidenceManager, mockPriceFeed;
  let landlord, tenant, other;

  before(async function () {
    [landlord, tenant, other] = await ethers.getSigners();

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

  it('malformed bytes to receiveCCIPDecisionRaw revert/are rejected', async function () {
    // create rent contract
    const rentAmount = ethers.parseEther('0.4');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 4444;

    const startDate = Math.floor(Date.now() / 1000);
    const durationDays = 30;
    const tx = await factory.connect(landlord).createEnhancedRentContractWithPolicy(
      tenant.address,
      rentAmount,
      mockPriceFeed.target ?? mockPriceFeed.address,
      dueDate,
      startDate,
      durationDays,
      propertyId
    );
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

    // send malformed bytes (too short) as decisionEncoded
    const bad = '0xdeadbeef';
    const messageId = ethers.id('malformed-1');
    await expect(arbitrationService.receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, bad))
      .to.be.reverted;
  });

  it('cross-sender replay guard: same messageId cannot be replayed by different caller', async function () {
    const rentAmount = ethers.parseEther('0.3');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 5555;

    const startDate2 = Math.floor(Date.now() / 1000);
    const durationDays2 = 30;
    const tx = await factory.connect(landlord).createEnhancedRentContractWithPolicy(
      tenant.address,
      rentAmount,
      mockPriceFeed.target ?? mockPriceFeed.address,
      dueDate,
      startDate2,
      durationDays2,
      propertyId
    );
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

    // sign and report a dispute
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
    const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
    const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
    await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
    await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

    const requested = ethers.parseEther('0.01');
    const percentageBond = (requested * 50n) / 10000n;
    const minBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minBond ? percentageBond : minBond;
    await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://cross', { value: requiredBond });

    const disputeId = ethers.id('cross-1');
    const messageId = ethers.id('cross-message-1');
    const decisionTuple = [disputeId, true, requested, landlord.address, 'ok', ethers.id('oracleX'), Math.floor(Date.now() / 1000), rentContract.target ?? rentContract.address, 0];
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)'],
      [decisionTuple]
    );

    // call raw decision from landlord (works)
    await arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);

    // same messageId from different caller should be rejected by processedCCIPDecisions
    await expect(arbitrationService.connect(other).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded))
      .to.be.revertedWith("Decision already processed");
  });

  it('large appliedAmount via CCIP records outstandingJudgement when > available', async function () {
    const rentAmount = ethers.parseEther('1.0');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 6666;

    const startDate3 = Math.floor(Date.now() / 1000);
    const durationDays3 = 30;
    const tx = await factory.connect(landlord).createEnhancedRentContractWithPolicy(
      tenant.address,
      rentAmount,
      mockPriceFeed.target ?? mockPriceFeed.address,
      dueDate,
      startDate3,
      durationDays3,
      propertyId
    );
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

  // sign core terms so onlyFullySigned modifiers pass (tenant must sign)
  const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
  const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
  const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
  await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
  await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

  // tenant deposits 0.2 into escrow
  await rentContract.connect(tenant).payRentPartial({ value: ethers.parseEther('0.2') });

    // report dispute
    const requested = ethers.parseEther('0.8');
    const percentageBond = (requested * 50n) / 10000n;
    const minBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minBond ? percentageBond : minBond;
    await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://large', { value: requiredBond });

    const disputeId = ethers.id('large-1');
    const messageId = ethers.id('large-message-1');
    const decisionTuple = [disputeId, true, requested, landlord.address, 'ok', ethers.id('oracleX'), Math.floor(Date.now() / 1000), rentContract.target ?? rentContract.address, 0];
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)'],
      [decisionTuple]
    );

  // capture escrow before applying decision because the resolution will consume escrow
  const escrowBefore = await rentContract.escrowBalance();

  // apply decision via raw path
  await arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);

  // outstandingJudgement should be recorded as requested - availableBefore
  const oj = await rentContract.outstandingJudgement(0);
  const expected = requested - escrowBefore; // no partyDeposit in this test
  expect(oj).to.equal(expected);
  });
});
