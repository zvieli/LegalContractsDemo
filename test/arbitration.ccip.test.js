import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('Arbitration CCIP: idempotency and raw decision path', function () {
  let factory, arbitrationService, merkleEvidenceManager, mockPriceFeed;
  let landlord, tenant;

  before(async function () {
    [landlord, tenant] = await ethers.getSigners();

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

  it('receiveCCIPDecision applies a decision and blocks replay by messageId', async function () {
    // create contract and dispute
    const rentAmount = ethers.parseEther('1.0');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 2222;

    const tx = await factory.connect(landlord).createEnhancedRentContract(
      tenant.address,
      rentAmount,
      mockPriceFeed.target ?? mockPriceFeed.address,
      dueDate,
      propertyId
    );
    const receipt = await tx.wait();
    const parsed = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } });
    const evt = parsed.find(e => e && e.name === 'EnhancedRentContractCreated');
    const rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);

    // sign core terms
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
    const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
    const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
    await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
    await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

    // report dispute
    const requested = ethers.parseEther('0.1');
    const percentageBond = (requested * 50n) / 10000n;
    const minBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minBond ? percentageBond : minBond;
    await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://ccip', { value: requiredBond });

    // prepare CCIP decision struct; the contract's receiveCCIPDecision expects the ArbitrationDecision struct
    const messageId = ethers.id('message-ccip-1');
    const decision = {
      disputeId: ethers.id('d1'),
      approved: true,
      appliedAmount: requested,
      beneficiary: landlord.address,
      rationale: 'ok',
      oracleId: ethers.id('oracle1'),
      timestamp: Math.floor(Date.now() / 1000),
      targetContract: rentContract.target ?? rentContract.address,
      caseId: 0
    };

    // call receiveCCIPDecision (which does not restrict caller in tests)
    const txr = await arbitrationService.receiveCCIPDecision(messageId, decision.targetContract, decision.caseId, decision);
    await txr.wait();

    // second call with same messageId should revert with "Decision already processed"
    await expect(arbitrationService.receiveCCIPDecision(messageId, decision.targetContract, decision.caseId, decision))
      .to.be.revertedWith("Decision already processed");
  });

  it('receiveCCIPDecisionRaw decodes and prevents replay', async function () {
    // deploy another rent instance
    const rentAmount = ethers.parseEther('0.8');
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const propertyId = 3333;

    const tx = await factory.connect(landlord).createEnhancedRentContract(
      tenant.address,
      rentAmount,
      mockPriceFeed.target ?? mockPriceFeed.address,
      dueDate,
      propertyId
    );
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

    // report dispute
    const requested = ethers.parseEther('0.02');
    const percentageBond = (requested * 50n) / 10000n;
    const minBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minBond ? percentageBond : minBond;
    await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://ccipraw', { value: requiredBond });

    // create encoded decision bytes as ABI-encoded CCIPArbitrationTypes.ArbitrationDecision
    const disputeId = ethers.id('d2');
    const messageId = ethers.id('message-ccip-raw-1');
    const decisionTuple = [disputeId, true, requested, landlord.address, 'ok', ethers.id('oracleX'), Math.floor(Date.now() / 1000), rentContract.target ?? rentContract.address, 0];
    // encode as a single tuple (struct) so abi.decode(..., (ArbitrationDecision)) matches
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256,address,uint256)'],
      [decisionTuple]
    );

    const txr = await arbitrationService.receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);
    await txr.wait();

    // second call should revert with "Decision already processed"
    await expect(arbitrationService.receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded))
      .to.be.revertedWith("Decision already processed");
  });
});
