// E2E Tests for ArbitrationService and Core DApp Logic
// Covers: Factory, Deposits, Evidence, Disputes, Arbitration, Withdrawals, Permissions, Full Flow

import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('ArbitrationService E2E Flow', function () {
  let factory, arbitrationService, arbitrator, rentContract;
  let landlord, tenant, admin;
  let evidenceDigest;
  let rentAmount = ethers.utils.parseEther('1');
  let requiredDeposit = ethers.utils.parseEther('0.5');
  let dueDate = Math.floor(Date.now() / 1000) + 86400;
  let propertyId = 123;
  let initialEvidenceUri = "ipfs://evidence1";
  let caseId = 1;

  before(async () => {
    [admin, landlord, tenant] = await ethers.getSigners();
    // Deploy ArbitrationService
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationService.connect(admin).deploy();
    await arbitrationService.deployed();

    // Deploy Factory
    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.connect(admin).deploy();
    await factory.deployed();
    await arbitrationService.connect(admin).setFactory(factory.address);

    // Deploy Arbitrator
    const Arbitrator = await ethers.getContractFactory('Arbitrator');
    arbitrator = await Arbitrator.connect(admin).deploy(arbitrationService.address);
    await arbitrator.deployed();
  });

  it('should create a new rent contract via factory', async () => {
    const tx = await factory.connect(landlord).createRentContract(
      landlord.address,
      tenant.address,
      rentAmount,
      dueDate,
      ethers.constants.AddressZero, // priceFeed stub
      propertyId,
      arbitrationService.address,
      requiredDeposit,
      initialEvidenceUri
    );
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'ContractCreated');
    expect(event).to.exist;
    rentContract = await ethers.getContractAt('TemplateRentContract', event.args.contractAddress);
    expect(await rentContract.arbitrationService()).to.equal(arbitrationService.address);
    expect(await rentContract.landlord()).to.equal(landlord.address);
    expect(await rentContract.tenant()).to.equal(tenant.address);
    expect(await rentContract.rentAmount()).to.equal(rentAmount);
  });

  it('should allow deposit and update balances', async () => {
    await expect(
      rentContract.connect(tenant).deposit({ value: requiredDeposit })
    ).to.emit(rentContract, 'DepositMade').withArgs(tenant.address, requiredDeposit);
    expect(await rentContract.withdrawable(tenant.address)).to.equal(requiredDeposit);
  });

  it('should allow evidence digest submission', async () => {
    evidenceDigest = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence-data"));
    await expect(
      rentContract.connect(tenant).submitEvidenceDigest(caseId, evidenceDigest)
    ).to.emit(rentContract, 'EvidenceSubmitted').withArgs(caseId, tenant.address, evidenceDigest);
    // Verify digest stored (if contract exposes)
  });

  it('should open a dispute and update status', async () => {
    await expect(
      rentContract.connect(tenant).openDispute(caseId)
    ).to.emit(rentContract, 'DisputeOpened').withArgs(caseId, tenant.address);
    expect(await rentContract.isDisputed(caseId)).to.be.true;
  });

  it('should apply arbitration resolution via ArbitrationService', async () => {
    // Simulate LLM decision: approve, appliedAmount, beneficiary
    const approve = true;
    const appliedAmount = requiredDeposit;
    const beneficiary = tenant.address;
    await expect(
      arbitrationService.connect(admin).applyResolutionToTarget(
        rentContract.address,
        caseId,
        approve,
        appliedAmount,
        beneficiary,
        { value: 0 }
      )
    ).to.emit(arbitrationService, 'ResolutionApplied').withArgs(
      rentContract.address,
      caseId,
      approve,
      appliedAmount,
      beneficiary,
      admin.address
    );
    // Verify contract state updated (if contract exposes)
  });

  it('should allow authorized withdrawal after resolution', async () => {
    const beforeBalance = await ethers.provider.getBalance(tenant.address);
    await expect(
      rentContract.connect(tenant).withdraw()
    ).to.emit(rentContract, 'FundsWithdrawn').withArgs(tenant.address, requiredDeposit);
    const afterBalance = await ethers.provider.getBalance(tenant.address);
    expect(afterBalance).to.be.gt(beforeBalance);
  });

  it('should prevent unauthorized actions', async () => {
    // Non-admin tries to apply resolution
    await expect(
      arbitrationService.connect(tenant).applyResolutionToTarget(
        rentContract.address,
        caseId,
        true,
        requiredDeposit,
        tenant.address,
        { value: 0 }
      )
    ).to.be.revertedWith('Only owner or factory');
    // Non-party tries to withdraw
    await expect(
      rentContract.connect(admin).withdraw()
    ).to.be.reverted;
  });

  it('should run full E2E scenario', async () => {
    // Create new contract
    const tx = await factory.connect(landlord).createRentContract(
      landlord.address,
      tenant.address,
      rentAmount,
      dueDate,
      ethers.constants.AddressZero,
      propertyId + 1,
      arbitrationService.address,
      requiredDeposit,
      "ipfs://evidence2"
    );
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'ContractCreated');
    const contractAddr = event.args.contractAddress;
    const contract = await ethers.getContractAt('TemplateRentContract', contractAddr);
    // Deposit
    await contract.connect(tenant).deposit({ value: requiredDeposit });
    // Evidence
    const digest = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("e2e-evidence"));
    await contract.connect(tenant).submitEvidenceDigest(caseId + 1, digest);
    // Dispute
    await contract.connect(tenant).openDispute(caseId + 1);
    // Arbitration
    await arbitrationService.connect(admin).applyResolutionToTarget(
      contract.address,
      caseId + 1,
      true,
      requiredDeposit,
      tenant.address,
      { value: 0 }
    );
    // Withdraw
    await contract.connect(tenant).withdraw();
    // Final state
    expect(await contract.withdrawable(tenant.address)).to.equal(0);
  });
});

// Each test should be implemented to check both events and state on-chain
// Edge cases: double withdraw, dispute without evidence, invalid LLM decision, etc.
// Use ethers.getContractAt if needed for deployed addresses
// Use expect(...).to.be.revertedWith for permission tests
// Use keccak256 for evidenceDigest
// Use admin as the authorized Oracle relay
