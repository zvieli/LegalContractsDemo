// E2E Tests for ArbitrationService and Core DApp Logic
// Covers: Factory, Deposits, Evidence, Disputes, Arbitration, Withdrawals, Permissions, Full Flow

import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe.skip('ArbitrationService E2E Flow (skipped pending refactor)', function () {
  let factory, arbitrationService, arbitrator, rentContract;
  let landlord, tenant, admin;
  let evidenceDigest;
  let rentAmount = ethers.parseEther('1');
  let requiredDeposit = ethers.parseEther('0.5');
  let dueDate = Math.floor(Date.now() / 1000) + 86400;
  let propertyId = 123;
  let initialEvidenceUri = "ipfs://evidence1";
  let caseId = 1;

  before(async () => {
    [admin, landlord, tenant] = await ethers.getSigners();
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationService.connect(admin).deploy();
    await arbitrationService.waitForDeployment();

    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.connect(admin).deploy();
    await factory.waitForDeployment();
    await arbitrationService.connect(admin).setFactory(factory.target);

    const Arbitrator = await ethers.getContractFactory('Arbitrator');
    arbitrator = await Arbitrator.connect(admin).deploy(arbitrationService.target);
    await arbitrator.waitForDeployment();
  });

  it('should create a new rent contract via factory', async () => {
    // Use minimal overload: (tenant, rentAmount, priceFeed, dueDate)
    const priceFeed = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
    const tx = await factory.connect(landlord).createRentContract(
      tenant.address,
      rentAmount,
      priceFeed,
      dueDate
    );
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'ContractCreated');
    expect(event).to.exist;
  rentContract = await ethers.getContractAt('TemplateRentContract', event.args.contractAddress);
  expect(await rentContract.arbitrationService()).to.equal(arbitrationService.target);
    expect(await rentContract.landlord()).to.equal(landlord.address);
    expect(await rentContract.tenant()).to.equal(tenant.address);
    expect(await rentContract.rentAmount()).to.equal(rentAmount);
  });

  it('should allow deposit and update balances', async () => {
    await expect(
      rentContract.connect(tenant).depositSecurity({ value: requiredDeposit })
    ).to.emit(rentContract, 'SecurityDeposited').withArgs(tenant.address, requiredDeposit);
    expect(await rentContract.partyDeposit(tenant.address)).to.equal(requiredDeposit);
  });

  it('should allow evidence digest submission', async () => {
    evidenceDigest = ethers.keccak256(ethers.toUtf8Bytes("evidence-data"));
    // New flow: submitEvidenceWithSignature (caseId, cid, contentDigest, recipientsHash, signature)
    // For simplicity, use submitEvidenceWithSignature with empty values except digest
    const cid = 'bafkrei' + '00'.repeat(5);
    const recipientsHash = ethers.ZeroHash;
    // Build a minimal EIP712 signature for the evidence submission
    const domain = { name: 'TemplateRentContract', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: rentContract.target };
    const types = { Evidence: [ { name: 'caseId', type: 'uint256' }, { name: 'cid', type: 'string' }, { name: 'contentDigest', type: 'bytes32' }, { name: 'recipientsHash', type: 'bytes32' } ] };
    const value = { caseId, cid, contentDigest: evidenceDigest, recipientsHash };
    const signature = await tenant.signTypedData(domain, types, value);
    await expect(
      rentContract.connect(tenant).submitEvidenceWithSignature(caseId, cid, evidenceDigest, recipientsHash, signature)
    ).to.emit(rentContract, 'EvidenceSubmittedDigest');
    // Verify digest stored (if contract exposes)
  });

  it('should open a dispute and update status', async () => {
    const requested = ethers.parseEther('0.05');
    const bond = requested * 5n / 1000n;
    await expect(
      rentContract.connect(tenant).reportDispute(caseId, requested, evidenceDigest, { value: bond })
    ).to.emit(rentContract, 'DisputeReported');
  });

  it('should apply arbitration resolution via ArbitrationService', async () => {
    // Simulate LLM decision: approve, appliedAmount, beneficiary
    const approve = true;
    const appliedAmount = requiredDeposit;
    const beneficiary = tenant.address;
    await expect(
      arbitrationService.connect(admin).applyResolutionToTarget(
        rentContract.target,
        caseId,
        approve,
        appliedAmount,
        beneficiary
      )
    ).to.emit(arbitrationService, 'ResolutionApplied');
    // Verify contract state updated (if contract exposes)
  });

  it('should allow authorized withdrawal after resolution', async () => {
    // Withdraw path: funds transferred directly on resolution (may be no withdrawable). Just assert deposit cleared.
    expect(await rentContract.partyDeposit(tenant.address)).to.equal(0);
  });

  it('should prevent unauthorized actions', async () => {
    // Non-admin tries to apply resolution
    await expect(
      arbitrationService.connect(tenant).applyResolutionToTarget(
        rentContract.target,
        caseId,
        true,
        requiredDeposit,
        tenant.address
      )
    ).to.be.reverted;
    // Non-party tries to withdraw
    // No generic withdraw for admin expected
    await expect(rentContract.connect(admin).withdraw()).to.be.reverted;
  });

  it('should run full E2E scenario', async () => {
    // Create new contract
    const priceFeed = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
    const tx = await factory.connect(landlord).createRentContract(
      tenant.address,
      rentAmount,
      priceFeed,
      dueDate
    );
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'ContractCreated');
    const contractAddr = event.args.contractAddress;
    const contract = await ethers.getContractAt('TemplateRentContract', contractAddr);
    // Deposit
  await contract.connect(tenant).depositSecurity({ value: requiredDeposit });
    // Evidence
  const digest = ethers.keccak256(ethers.toUtf8Bytes("e2e-evidence"));
  const cid2 = 'bafkre' + '11'.repeat(5);
  const recipientsHash2 = ethers.ZeroHash;
  const domain2 = { name: 'TemplateRentContract', version:'1', chainId:(await ethers.provider.getNetwork()).chainId, verifyingContract: contract.target };
  const types2 = { Evidence: [ { name:'caseId', type:'uint256' }, { name:'cid', type:'string' }, { name:'contentDigest', type:'bytes32' }, { name:'recipientsHash', type:'bytes32' } ] };
  const value2 = { caseId: caseId + 1, cid: cid2, contentDigest: digest, recipientsHash: recipientsHash2 };
  const sig2 = await tenant.signTypedData(domain2, types2, value2);
  await contract.connect(tenant).submitEvidenceWithSignature(caseId + 1, cid2, digest, recipientsHash2, sig2);
  const req2 = ethers.parseEther('0.02');
  const bond2 = req2 * 5n / 1000n;
  await contract.connect(tenant).reportDispute(caseId + 1, req2, digest, { value: bond2 });
    // Arbitration
    await arbitrationService.connect(admin).applyResolutionToTarget(
      contract.target,
      caseId + 1,
      true,
      req2,
      tenant.address
    );
    // After resolution tenant deposit for that case should be zero (direct transfer path)
    expect(await contract.partyDeposit(tenant.address)).to.equal(0);
  });
});

// Each test should be implemented to check both events and state on-chain
// Edge cases: double withdraw, dispute without evidence, invalid LLM decision, etc.
// Use ethers.getContractAt if needed for deployed addresses
// Use expect(...).to.be.revertedWith for permission tests
// Use keccak256 for evidenceDigest
// Use admin as the authorized Oracle relay
