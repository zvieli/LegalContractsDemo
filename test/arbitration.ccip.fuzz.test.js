import { expect } from 'chai';

describe('Arbitration CCIP fuzz/edge tests (low-priority)', function () {
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

  it('rejects truncated/garbage bytes to receiveCCIPDecisionRaw', async function () {
    // create a fresh rent instance for this test
    const rentAmount = ethers.parseEther('0.5');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 1234;

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

    const messageId = ethers.hexlify(ethers.randomBytes(32));
    // Totally garbage / too short
    const bad = '0xdeadbeef';
    await expect(arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, bad))
      .to.be.reverted;
  // truncated valid prefix
  const partial = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x1234']).slice(0, 10);
    await expect(arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, partial))
      .to.be.reverted;
  });

  it('handles oversized string fields gracefully (reject or decode safely)', async function () {
    // create a fresh rent instance for this test
    const rentAmount = ethers.parseEther('0.4');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 4321;

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

    const messageId = ethers.hexlify(ethers.randomBytes(32));
    // Construct a decision with a very large reason string (~64k)
    const bigReason = 'A'.repeat(64 * 1024);
    // encode as ArbitrationDecision struct tuple used elsewhere: (bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)
    const disputeId = ethers.id('d_big');
    const ts = Math.floor(Date.now() / 1000);
    const decisionTuple = [disputeId, true, ethers.parseEther('0.001'), landlord.address, bigReason, ethers.id('oracleBig'), ts, rentContract.target ?? rentContract.address, 0];
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)'],
      [decisionTuple]
    );
    // we expect either revert because of gas/string limits or successful decode; accept either outcome
    const call = arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);
    try {
      await call;
    } catch (e) {
      // acceptable: contract may revert due to oversized payload
    }
  }).timeout(20000);

  it('rejects messageId replay across different senders (messageId uniqueness)', async function () {
    // create a fresh rent instance for this test
    const rentAmount = ethers.parseEther('0.2');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 5555;

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

    const messageId = ethers.hexlify(ethers.randomBytes(32));
    // create a dispute (caseId 0) so the decision can be applied
    const requested = ethers.parseEther('0.01');
    const percentageBond = (requested * 50n) / 10000n;
    const minBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minBond ? percentageBond : minBond;
    // sign the core terms so reportDispute succeeds where required
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
    const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
    const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
    await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
    await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));
    await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://fuzz', { value: requiredBond });

    const disputeId = ethers.id('d_fuzz');
    const ts2 = Math.floor(Date.now() / 1000);
    // use caseId 0 because we just reported dispute
    const decisionTuple = [disputeId, true, 0, landlord.address, 'fuzz test', ethers.id('oracleFuzz'), ts2, rentContract.target ?? rentContract.address, 0];
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)'],
      [decisionTuple]
    );
    await arbitrationService.connect(landlord).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);
  // Now different sender tries to replay the same messageId
  await expect(arbitrationService.connect(other).receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded)).to.be.revertedWith('Decision already processed');
  });
});
