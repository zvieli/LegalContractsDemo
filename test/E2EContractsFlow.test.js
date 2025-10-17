// E2EContractsFlow.test.js
// Covers full contract lifecycle: Factory → EnhancedRentContract/NDATemplate → Evidence → Dispute → Arbitration → Resolution

import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;
import { MerkleEvidenceHelper } from '../utils/merkleEvidenceHelper.js';

describe('E2E Contracts Flow', function () {
  let factory, rentContract, ndaContract, landlord, tenant, partyA, partyB, arbitrationService, merkleEvidenceManager, ccipSender;

  before(async function () {
    // Deploy signers
    [landlord, tenant, partyA, partyB] = await ethers.getSigners();

    // Deploy MerkleEvidenceManager
    const MerkleEvidenceManager = await ethers.getContractFactory('MerkleEvidenceManager');
    merkleEvidenceManager = await MerkleEvidenceManager.deploy();
    await merkleEvidenceManager.waitForDeployment();

    // Deploy ArbitrationService
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();

    // Deploy CCIPArbitrationSender (for CCIP integration)
    const CCIPArbitrationSender = await ethers.getContractFactory('CCIPArbitrationSender');
    const MAINNET_CCIP_ROUTER = "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D";
    const MAINNET_LINK_TOKEN = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
    const FORK_CHAIN_SELECTOR = "31337"; // Our local fork chain ID
    ccipSender = await CCIPArbitrationSender.deploy(
      MAINNET_CCIP_ROUTER,
      MAINNET_LINK_TOKEN,
      FORK_CHAIN_SELECTOR,
      landlord.address // Use landlord as initial oracle receiver for testing
    );
    await ccipSender.waitForDeployment();

    // Deploy Factory
    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.deploy();
    await factory.waitForDeployment();
    await factory.setDefaultArbitrationService(arbitrationService.target);
    await factory.setMerkleEvidenceManager(merkleEvidenceManager.target);

    // Configure CCIP sender in contracts (example for NDA)
    // If you deploy NDA/Rent contracts here, configure CCIP
    // ndaContract.configureCCIP(ccipSender.target, true);
    // rentContract.configureCCIP(ccipSender.target, true);

    // Optionally: Start CCIP listener (off-chain)
    // await startCCIPListener();
  });

 describe('EnhancedRentContract Flow', function () {
  let rentAmount, dueDate, propertyId;

  beforeEach(async function () {
    rentAmount = ethers.parseEther('1.0');
    dueDate = Math.floor(Date.now() / 1000) + 86400;
    propertyId = 12345;

    const tx = await factory.connect(landlord).createEnhancedRentContract(
      tenant.address,
      rentAmount,
      '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
      dueDate,
      propertyId
    );
    const receipt = await tx.wait();
    const parsedLogs = receipt.logs.map(l => {
      try { return factory.interface.parseLog(l); } catch { return null; }
    });
    const evt = parsedLogs.find(e => e && e.name === 'EnhancedRentContractCreated');
    rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);
  });

  it('should sign by both parties (EIP712)', async function () {
    // Prepare EIP712 domain and types
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await landlord.provider.getNetwork()).chainId,
      verifyingContract: rentContract.target ?? rentContract.address
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const value = {
      contractAddress: rentContract.target ?? rentContract.address,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };
    // landlord signs
    const sigLandlord = await landlord.signTypedData(domain, types, value);
    await expect(rentContract.connect(landlord).signRent(sigLandlord)).to.emit(rentContract, 'RentSigned');
    // tenant signs
    const sigTenant = await tenant.signTypedData(domain, types, value);
    await expect(rentContract.connect(tenant).signRent(sigTenant)).to.emit(rentContract, 'RentSigned');
    // Check contract status
    expect(await rentContract.rentSigned()).to.be.true;
  });

  it('should allow payment and deposit', async function () {
    // Ensure contract is signed by both parties first
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await landlord.provider.getNetwork()).chainId,
      verifyingContract: rentContract.target ?? rentContract.address
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const value = {
      contractAddress: rentContract.target ?? rentContract.address,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };
    // landlord signs
    const sigLandlord = await landlord.signTypedData(domain, types, value);
    await rentContract.connect(landlord).signRent(sigLandlord);
    // tenant signs
    const sigTenant = await tenant.signTypedData(domain, types, value);
    await rentContract.connect(tenant).signRent(sigTenant);

    // Now proceed with payment and deposit
    // Tenant pays rent
    const rentValue = rentAmount;
    const txRent = await rentContract.connect(tenant).payRentInEth({ value: rentValue.toString() });
    const receiptRent = await txRent.wait();
    const rentEvents = receiptRent.logs.map(log => {
      try { return rentContract.interface.parseLog(log); } catch { return null; }
    }).filter(e => e && e.name === 'RentPaid');
    expect(rentEvents.length).to.equal(1);
    expect(rentEvents[0].args.tenant).to.equal(tenant.address);
    expect(rentEvents[0].args.amount).to.equal(rentValue);
    expect(rentEvents[0].args.late).to.be.false;

    // Check rentPaid status
    expect(await rentContract.rentPaid()).to.be.true;

    // Tenant pays deposit
    const depositValue = ethers.parseEther('0.5');
    const txDeposit = await rentContract.connect(tenant).depositSecurity({ value: depositValue.toString() });
    const receiptDeposit = await txDeposit.wait();
    const depositEvents = receiptDeposit.logs.map(log => {
      try { return rentContract.interface.parseLog(log); } catch { return null; }
    }).filter(e => e && e.name === 'SecurityDepositPaid');
    expect(depositEvents.length).to.equal(1);
    expect(depositEvents[0].args.by).to.equal(tenant.address);
    expect(depositEvents[0].args.amount).to.equal(depositValue);
    expect(depositEvents[0].args.total).to.equal(depositValue);

    // Check deposit balance
    expect(await rentContract.partyDeposit(tenant.address)).to.equal(depositValue);
  });

  it('should submit evidence (Merkle batch)', async function () {
    // Create evidence items
    const evidenceHelper = new MerkleEvidenceHelper();
    
    // Add multiple evidence items
    evidenceHelper.addEvidence({
      caseId: 1,
      contentDigest: ethers.keccak256(ethers.toUtf8Bytes('Evidence content 1')),
      cidHash: ethers.keccak256(ethers.toUtf8Bytes('CID1')),
      uploader: landlord.address,
      timestamp: Math.floor(Date.now() / 1000)
    });
    
    evidenceHelper.addEvidence({
      caseId: 1,
      contentDigest: ethers.keccak256(ethers.toUtf8Bytes('Evidence content 2')),
      cidHash: ethers.keccak256(ethers.toUtf8Bytes('CID2')),
      uploader: tenant.address,
      timestamp: Math.floor(Date.now() / 1000) + 1
    });
    
    // Build Merkle tree
    evidenceHelper.buildTree();
    const merkleRoot = evidenceHelper.getRoot();
    
    // Submit evidence batch
    const tx = await merkleEvidenceManager.connect(landlord).submitEvidenceBatch(
      merkleRoot,
      evidenceHelper.getAllEvidenceItems().length
    );
    const receipt = await tx.wait();
    
    // Check BatchCreated event
    const batchEvents = receipt.logs.map(log => {
      try { return merkleEvidenceManager.interface.parseLog(log); } catch { return null; }
    }).filter(e => e && e.name === 'BatchCreated');
    expect(batchEvents.length).to.equal(1);
    expect(batchEvents[0].args.merkleRoot).to.equal(merkleRoot);
    expect(batchEvents[0].args.evidenceCount).to.equal(2);
    expect(batchEvents[0].args.submitter).to.equal(landlord.address);
    
    const batchId = batchEvents[0].args.batchId;
    
    // Verify first evidence item
    const evidenceItem = evidenceHelper.getEvidenceItem(0);
    const proof = evidenceHelper.getProof(0);
    
    const verifyTx = await merkleEvidenceManager.connect(tenant).verifyEvidence(
      batchId,
      evidenceItem,
      proof
    );
    const verifyReceipt = await verifyTx.wait();
    
    // Check EvidenceVerified event
    const verifyEvents = verifyReceipt.logs.map(log => {
      try { return merkleEvidenceManager.interface.parseLog(log); } catch { return null; }
    }).filter(e => e && e.name === 'EvidenceVerified');
    expect(verifyEvents.length).to.equal(1);
    expect(verifyEvents[0].args.batchId).to.equal(batchId);
    expect(verifyEvents[0].args.caseId).to.equal(evidenceItem.caseId);
    expect(verifyEvents[0].args.cidHash).to.equal(evidenceItem.cidHash);
    expect(verifyEvents[0].args.uploader).to.equal(evidenceItem.uploader);
    
    // Check batch information
    const batch = await merkleEvidenceManager.getBatch(batchId);
    expect(batch.merkleRoot).to.equal(merkleRoot);
    expect(batch.evidenceCount).to.equal(2);
    expect(batch.submitter).to.equal(landlord.address);
    expect(batch.finalized).to.be.false;
  });

  it('should open dispute and report breach', async function () {
    // First ensure contract is signed and has deposits
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await landlord.provider.getNetwork()).chainId,
      verifyingContract: rentContract.target ?? rentContract.address
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const value = {
      contractAddress: rentContract.target ?? rentContract.address,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };
    
    // Sign by both parties
    const sigLandlord = await landlord.signTypedData(domain, types, value);
    await rentContract.connect(landlord).signRent(sigLandlord);
    const sigTenant = await tenant.signTypedData(domain, types, value);
    await rentContract.connect(tenant).signRent(sigTenant);
    
    // Make deposit
    const depositValue = ethers.parseEther('0.5');
    await rentContract.connect(tenant).depositSecurity({ value: depositValue });
    
    // Landlord reports dispute for property damage
    const disputeType = 0; // Damage
    const requestedAmount = ethers.parseEther('0.3');
  const evidenceUri = 'helia://QmEvidence123';
    
    // Calculate required bond (0.5% of requested amount or minimum 0.001 ether)
    const percentageBond = (requestedAmount * 50n) / 10000n; // 0.5%
    const minimumBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minimumBond ? percentageBond : minimumBond;
    
    // Report dispute with bond payment
    const tx = await rentContract.connect(landlord).reportDispute(
      disputeType,
      requestedAmount,
      evidenceUri,
      { value: requiredBond }
    );
    const receipt = await tx.wait();
    
    // Parse events
    const events = receipt.logs.map(log => {
      try { return rentContract.interface.parseLog(log); } catch { return null; }
    }).filter(e => e !== null);
    
    // Check DisputeReported event
    const disputeReportedEvents = events.filter(e => e.name === 'DisputeReported');
    expect(disputeReportedEvents.length).to.equal(1);
    expect(disputeReportedEvents[0].args.initiator).to.equal(landlord.address);
    expect(disputeReportedEvents[0].args.disputeType).to.equal(disputeType);
    expect(disputeReportedEvents[0].args.requestedAmount).to.equal(requestedAmount);
    const caseId = disputeReportedEvents[0].args.caseId;
    
    // Check DisputeReportedWithUri event
    const disputeUriEvents = events.filter(e => e.name === 'DisputeReportedWithUri');
    expect(disputeUriEvents.length).to.equal(1);
    expect(disputeUriEvents[0].args.caseId).to.equal(caseId);
    expect(disputeUriEvents[0].args.evidenceUri).to.equal(evidenceUri);
    
    // Check DisputeFiled event
    const disputeFiledEvents = events.filter(e => e.name === 'DisputeFiled');
    expect(disputeFiledEvents.length).to.equal(1);
    expect(disputeFiledEvents[0].args.caseId).to.equal(caseId);
    expect(disputeFiledEvents[0].args.debtor).to.equal(tenant.address);
    expect(disputeFiledEvents[0].args.requestedAmount).to.equal(requestedAmount);
    
    // Verify dispute data stored correctly
    const disputeUri = await rentContract.getDisputeUri(caseId);
    expect(disputeUri).to.equal(evidenceUri);
    
    // Check that bond was recorded
    const storedBond = await rentContract.getDisputeBond(caseId);
    expect(storedBond).to.equal(requiredBond);
  });

  it('should resolve dispute via ArbitrationService', async function () {
    // First set up a dispute (reuse setup from previous test)
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await landlord.provider.getNetwork()).chainId,
      verifyingContract: rentContract.target ?? rentContract.address
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const value = {
      contractAddress: rentContract.target ?? rentContract.address,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };
    
    // Sign by both parties
    const sigLandlord = await landlord.signTypedData(domain, types, value);
    await rentContract.connect(landlord).signRent(sigLandlord);
    const sigTenant = await tenant.signTypedData(domain, types, value);
    await rentContract.connect(tenant).signRent(sigTenant);
    
    // Make deposit
    const depositValue = ethers.parseEther('0.5');
    await rentContract.connect(tenant).depositSecurity({ value: depositValue });
    
    // Landlord reports dispute
    const disputeType = 0; // Damage
    const requestedAmount = ethers.parseEther('0.3');
    const evidenceUri = 'ipfs://QmEvidence123';
    const percentageBond = (requestedAmount * 50n) / 10000n;
    const minimumBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minimumBond ? percentageBond : minimumBond;
    
    const tx = await rentContract.connect(landlord).reportDispute(
      disputeType,
      requestedAmount,
      evidenceUri,
      { value: requiredBond }
    );
    const receipt = await tx.wait();
    const disputeEvents = receipt.logs.map(log => {
      try { return rentContract.interface.parseLog(log); } catch { return null; }
    }).filter(e => e && e.name === 'DisputeReported');
    const caseId = disputeEvents[0].args.caseId;
    
    // Now resolve the dispute via ArbitrationService
    // Approve the dispute and award the full requested amount to landlord
    const approve = true;
    const appliedAmount = requestedAmount;
    const beneficiary = landlord.address;
    
    // Get initial balances
    const initialLandlordBalance = await ethers.provider.getBalance(landlord.address);
    const initialTenantDeposit = await rentContract.partyDeposit(tenant.address);
    
    // Resolve via ArbitrationService (owner can call this)
    const [owner] = await ethers.getSigners(); // First signer is owner
    const resolveTx = await arbitrationService.connect(owner).applyResolutionToTarget(
      rentContract.target,
      caseId,
      approve,
      appliedAmount,
      beneficiary
    );
    const resolveReceipt = await resolveTx.wait();
    
    // Check ResolutionApplied event from ArbitrationService
    const arbitrationEvents = resolveReceipt.logs.map(log => {
      try { return arbitrationService.interface.parseLog(log); } catch { return null; }
    }).filter(e => e !== null);
    
    const resolutionAppliedEvents = arbitrationEvents.filter(e => e.name === 'ResolutionApplied');
    expect(resolutionAppliedEvents.length).to.equal(1);
    expect(resolutionAppliedEvents[0].args.target).to.equal(rentContract.target);
    expect(resolutionAppliedEvents[0].args.caseId).to.equal(caseId);
    expect(resolutionAppliedEvents[0].args.approve).to.equal(approve);
    expect(resolutionAppliedEvents[0].args.appliedAmount).to.equal(appliedAmount);
    expect(resolutionAppliedEvents[0].args.beneficiary).to.equal(beneficiary);
    
    // Check contract events: DisputeResolved, DisputeClosed, DisputeRationale
    const contractEvents = resolveReceipt.logs.map(log => {
      try { return rentContract.interface.parseLog(log); } catch { return null; }
    }).filter(e => e !== null);
    
    const disputeResolvedEvents = contractEvents.filter(e => e.name === 'DisputeResolved');
    expect(disputeResolvedEvents.length).to.equal(1);
    expect(disputeResolvedEvents[0].args.caseId).to.equal(caseId);
    expect(disputeResolvedEvents[0].args.approved).to.equal(approve);
    expect(disputeResolvedEvents[0].args.appliedAmount).to.equal(appliedAmount);
    expect(disputeResolvedEvents[0].args.beneficiary).to.equal(beneficiary);
    
    const disputeClosedEvents = contractEvents.filter(e => e.name === 'DisputeClosed');
    expect(disputeClosedEvents.length).to.equal(1);
    expect(disputeClosedEvents[0].args.caseId).to.equal(caseId);
    
    const disputeRationaleEvents = contractEvents.filter(e => e.name === 'DisputeRationale');
    expect(disputeRationaleEvents.length).to.equal(1);
    expect(disputeRationaleEvents[0].args.caseId).to.equal(caseId);
    
    // Verify final state
    const finalTenantDeposit = await rentContract.partyDeposit(tenant.address);
    expect(finalTenantDeposit).to.equal(initialTenantDeposit - appliedAmount);
    
    // Check that landlord received the funds (approximately, accounting for gas)
    const finalLandlordBalance = await ethers.provider.getBalance(landlord.address);
    expect(finalLandlordBalance).to.be.closeTo(initialLandlordBalance + appliedAmount, ethers.parseEther('0.01')); // Allow for gas costs
  });

  it('should emit all relevant events', async function () {
    // Track all events emitted during the full flow
    const allEvents = [];
    
    // Helper to collect events from receipts
    const collectEvents = (receipt, contract) => {
      const events = receipt.logs.map(log => {
        try { return contract.interface.parseLog(log); } catch { return null; }
      }).filter(e => e !== null);
      allEvents.push(...events);
    };
    
    // 1. Sign the contract
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await landlord.provider.getNetwork()).chainId,
      verifyingContract: rentContract.target ?? rentContract.address
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const value = {
      contractAddress: rentContract.target ?? rentContract.address,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };
    
    const sigLandlord = await landlord.signTypedData(domain, types, value);
    const signLandlordTx = await rentContract.connect(landlord).signRent(sigLandlord);
    collectEvents(await signLandlordTx.wait(), rentContract);
    
    const sigTenant = await tenant.signTypedData(domain, types, value);
    const signTenantTx = await rentContract.connect(tenant).signRent(sigTenant);
    collectEvents(await signTenantTx.wait(), rentContract);
    
    // 2. Pay rent
    const rentValue = rentAmount;
    const payRentTx = await rentContract.connect(tenant).payRentInEth({ value: rentValue });
    collectEvents(await payRentTx.wait(), rentContract);
    
    // 3. Deposit security
    const depositValue = ethers.parseEther('0.5');
    const depositTx = await rentContract.connect(tenant).depositSecurity({ value: depositValue });
    collectEvents(await depositTx.wait(), rentContract);
    
    // 4. Submit evidence batch
    const evidenceHelper = new MerkleEvidenceHelper();
    evidenceHelper.addEvidence({
      caseId: 1,
      contentDigest: ethers.keccak256(ethers.toUtf8Bytes('Evidence content')),
      cidHash: ethers.keccak256(ethers.toUtf8Bytes('CID1')),
      uploader: landlord.address,
      timestamp: Math.floor(Date.now() / 1000)
    });
    evidenceHelper.buildTree();
    const merkleRoot = evidenceHelper.getRoot();
    
    const evidenceTx = await merkleEvidenceManager.connect(landlord).submitEvidenceBatch(
      merkleRoot,
      evidenceHelper.getAllEvidenceItems().length
    );
    collectEvents(await evidenceTx.wait(), merkleEvidenceManager);
    
    // 5. Report dispute
    const disputeType = 0;
    const requestedAmount = ethers.parseEther('0.3');
    const evidenceUri = 'ipfs://QmEvidence123';
    const percentageBond = (requestedAmount * 50n) / 10000n;
    const minimumBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minimumBond ? percentageBond : minimumBond;
    
    const disputeTx = await rentContract.connect(landlord).reportDispute(
      disputeType,
      requestedAmount,
      evidenceUri,
      { value: requiredBond }
    );
    collectEvents(await disputeTx.wait(), rentContract);
    
    // 6. Resolve dispute
    const disputeEvents = allEvents.filter(e => e.name === 'DisputeReported');
    const caseId = disputeEvents[0].args.caseId;
    
    const [owner] = await ethers.getSigners();
    const resolveTx = await arbitrationService.connect(owner).applyResolutionToTarget(
      rentContract.target,
      caseId,
      true, // approve
      requestedAmount,
      landlord.address
    );
    collectEvents(await resolveTx.wait(), arbitrationService);
    collectEvents(await resolveTx.wait(), rentContract);
    
    // Verify all expected events are present
    const eventNames = allEvents.map(e => e.name);
    
    // Contract signing events
    expect(eventNames).to.include('RentSigned');
    expect(eventNames.filter(name => name === 'RentSigned')).to.have.lengthOf(2);
    
    // Payment events
    expect(eventNames).to.include('RentPaid');
    expect(eventNames).to.include('SecurityDepositPaid');
    
    // Evidence events
    expect(eventNames).to.include('BatchCreated');
    
    // Dispute events
    expect(eventNames).to.include('DisputeReported');
    expect(eventNames).to.include('DisputeReportedWithUri');
    expect(eventNames).to.include('DisputeFiled');
    
    // Resolution events
    expect(eventNames).to.include('ResolutionApplied');
    expect(eventNames).to.include('DisputeResolved');
    expect(eventNames).to.include('DisputeClosed');
    expect(eventNames).to.include('DisputeRationale');
    
    // Verify event data consistency
    const rentPaidEvents = allEvents.filter(e => e.name === 'RentPaid');
    expect(rentPaidEvents[0].args.amount).to.equal(rentValue);
    expect(rentPaidEvents[0].args.tenant).to.equal(tenant.address);
    
    const depositEvents = allEvents.filter(e => e.name === 'SecurityDepositPaid');
    expect(depositEvents[0].args.amount).to.equal(depositValue);
    expect(depositEvents[0].args.by).to.equal(tenant.address);
    
    const batchEvents = allEvents.filter(e => e.name === 'BatchCreated');
    expect(batchEvents[0].args.merkleRoot).to.equal(merkleRoot);
    
    const resolutionEvents = allEvents.filter(e => e.name === 'ResolutionApplied');
    expect(resolutionEvents[0].args.target).to.equal(rentContract.target);
    expect(resolutionEvents[0].args.caseId).to.equal(caseId);
  });

  it('should handle edge cases', async function () {
    // Define test parameters
    const rentAmount = ethers.parseEther('1.0');
    const securityDeposit = ethers.parseEther('0.5');
    const dueDate = Math.floor(Date.now() / 1000) + 86400;

    // Create a fresh contract for edge cases testing
    const tx = await factory.connect(landlord).createEnhancedRentContract(
      tenant.address,
      rentAmount,
      '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', // price feed
      dueDate,
      12345 // propertyId
    );
    const receipt = await tx.wait();
    const parsedLogs = receipt.logs.map(l => {
      try { return factory.interface.parseLog(l); } catch { return null; }
    });
    const evt = parsedLogs.find(e => e && e.name === 'EnhancedRentContractCreated');
    const edgeRentContract = await ethers.getContractAt('TemplateRentContract', evt.args.contractAddress);

    // Sign the contract
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await landlord.provider.getNetwork()).chainId,
      verifyingContract: edgeRentContract.target ?? edgeRentContract.address
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const value = {
      contractAddress: edgeRentContract.target ?? edgeRentContract.address,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };

    const sigLandlord = await landlord.signTypedData(domain, types, value);
    await edgeRentContract.connect(landlord).signRent(sigLandlord);
    const sigTenant = await tenant.signTypedData(domain, types, value);
    await edgeRentContract.connect(tenant).signRent(sigTenant);

    // Make deposit
    const depositValue = ethers.parseEther('0.5');
    await edgeRentContract.connect(tenant).depositSecurity({ value: depositValue });

    // Test 1: Non-party cannot report dispute
    await expect(
  edgeRentContract.connect(partyA).reportDispute(0, ethers.parseEther('0.1'), 'helia://test', { value: ethers.parseEther('0.001') })
    ).to.be.revertedWithCustomError(edgeRentContract, 'NotParty');
    
    // Test 2: Cannot report dispute with zero amount for damage claims
    await expect(
  edgeRentContract.connect(landlord).reportDispute(0, 0, 'helia://test', { value: ethers.parseEther('0.001') })
    ).to.be.revertedWithCustomError(edgeRentContract, 'AmountTooLow');
    
    // Test 3: Insufficient bond should revert
    const requestedAmount = ethers.parseEther('0.3');
    const insufficientBond = ethers.parseEther('0.0001'); // Too low
    await expect(
  edgeRentContract.connect(landlord).reportDispute(0, requestedAmount, 'helia://test', { value: insufficientBond })
    ).to.be.revertedWithCustomError(edgeRentContract, 'InsufficientFee');
    
    // Test 4: Valid dispute reporting
    const percentageBond = (requestedAmount * 50n) / 10000n;
    const minimumBond = ethers.parseEther('0.001');
    const requiredBond = percentageBond > minimumBond ? percentageBond : minimumBond;
    
    const disputeTx = await edgeRentContract.connect(landlord).reportDispute(
  0, requestedAmount, 'helia://test', { value: requiredBond }
    );
    const disputeReceipt = await disputeTx.wait();
    const disputeEvents = disputeReceipt.logs.map(log => {
      try { return edgeRentContract.interface.parseLog(log); } catch { return null; }
    }).filter(e => e && e.name === 'DisputeReported');
    const caseId = disputeEvents[0].args.caseId;

    // Test 5: Cannot resolve already resolved dispute
    const [serviceOwner] = await ethers.getSigners();
    await arbitrationService.connect(serviceOwner).applyResolutionToTarget(
      edgeRentContract.target, caseId, true, requestedAmount, landlord.address
    );

    // Try to resolve again - should fail
    await expect(
      arbitrationService.connect(serviceOwner).applyResolutionToTarget(
        edgeRentContract.target, caseId, false, 0, tenant.address
      )
    ).to.be.reverted; // Should fail due to replay protection or already resolved

    // Test 6: Invalid dispute ID access
    await expect(
      edgeRentContract.getDisputeUri(999)
    ).to.be.revertedWith('bad id');
    
    // Test 7: Cannot report dispute on inactive contract
    // Create a new contract for this test
    const cancelTx = await factory.connect(landlord).createEnhancedRentContract(
      tenant.address,
      rentAmount,
      '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', // price feed
      dueDate,
      12346 // propertyId
    );
    const cancelReceipt = await cancelTx.wait();
    const cancelParsedLogs = cancelReceipt.logs.map(l => {
      try { return factory.interface.parseLog(l); } catch { return null; }
    });
    const cancelEvt = cancelParsedLogs.find(e => e && e.name === 'EnhancedRentContractCreated');
    const cancelRentContract = await ethers.getContractAt('TemplateRentContract', cancelEvt.args.contractAddress);

    // Sign the contract
    const cancelDomain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: cancelRentContract.target
    };
    const cancelTypes = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    const cancelValue = {
      contractAddress: cancelRentContract.target,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount,
      dueDate
    };

    const cancelSigLandlord = await landlord.signTypedData(cancelDomain, cancelTypes, cancelValue);
    await cancelRentContract.connect(landlord).signRent(cancelSigLandlord);
    const cancelSigTenant = await tenant.signTypedData(cancelDomain, cancelTypes, cancelValue);
    await cancelRentContract.connect(tenant).signRent(cancelSigTenant);

    // Make deposit
    await cancelRentContract.connect(tenant).depositSecurity({ value: securityDeposit });

    // Initiate cancellation
    await cancelRentContract.connect(landlord).initiateCancellation();

    // Approve cancellation
    await cancelRentContract.connect(tenant).approveCancellation();

    // Finalize cancellation through ArbitrationService
    await arbitrationService.connect(serviceOwner).finalizeTargetCancellation(cancelRentContract.target);

    // Now try to report dispute on inactive contract - should fail
    await expect(
  cancelRentContract.connect(landlord).reportDispute(0, ethers.parseEther('0.1'), 'helia://test', { value: ethers.parseEther('0.001') })
    ).to.be.revertedWithCustomError(cancelRentContract, 'NotActive');
  });
});


 describe('NDATemplate Flow', function () {
    let ndaContract, expiryDate, penaltyBps, minDeposit;

    beforeEach(async function () {
      expiryDate = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days from now
      penaltyBps = 500; // 5%
      minDeposit = ethers.parseEther('0.1');

      const tx = await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        penaltyBps,
        ethers.ZeroHash, // no custom clauses
        minDeposit,
        0 // PayFeesIn.ETH
      );
      const receipt = await tx.wait();
      const parsedLogs = receipt.logs.map(l => {
        try { return factory.interface.parseLog(l); } catch { return null; }
      });
      const evt = parsedLogs.find(e => e && e.name === 'NDACreated');
      ndaContract = await ethers.getContractAt('NDATemplate', evt.args.contractAddress);
    });

    it('should deploy NDA contract via factory', async function () {
      expect(ndaContract.target).to.not.be.undefined;
      expect(await ndaContract.partyA()).to.equal(partyA.address);
      expect(await ndaContract.partyB()).to.equal(partyB.address);
      expect(await ndaContract.expiryDate()).to.equal(expiryDate);
      expect(await ndaContract.penaltyBps()).to.equal(penaltyBps);
      expect(await ndaContract.minDeposit()).to.equal(minDeposit);
      expect(await ndaContract.active()).to.be.true;
    });

    it('should sign by both parties (EIP712)', async function () {
      // First make deposits
      await ndaContract.connect(partyA).deposit({ value: minDeposit });
      await ndaContract.connect(partyB).deposit({ value: minDeposit });

      // Prepare EIP712 domain and types
      const domain = {
        name: 'NDATemplate',
        version: '1',
        chainId: (await partyA.provider.getNetwork()).chainId,
        verifyingContract: ndaContract.target ?? ndaContract.address
      };
      const types = {
        NDA: [
          { name: 'contractAddress', type: 'address' },
          { name: 'expiryDate', type: 'uint256' },
          { name: 'penaltyBps', type: 'uint16' },
          { name: 'customClausesHash', type: 'bytes32' }
        ]
      };
      const value = {
        contractAddress: ndaContract.target ?? ndaContract.address,
        expiryDate: BigInt(expiryDate),
        penaltyBps: penaltyBps,
        customClausesHash: ethers.ZeroHash
      };

      // partyA signs
      const sigA = await partyA.signTypedData(domain, types, value);
      await expect(ndaContract.connect(partyA).signNDA(sigA)).to.emit(ndaContract, 'NDASigned');
      
      // partyB signs
      const sigB = await partyB.signTypedData(domain, types, value);
      const signTx = await ndaContract.connect(partyB).signNDA(sigB);
      const receipt = await signTx.wait();
      
      // Check events
      const events = receipt.logs.map(log => {
        try { return ndaContract.interface.parseLog(log); } catch { return null; }
      }).filter(e => e !== null);
      
      const ndaSignedEvents = events.filter(e => e.name === 'NDASigned');
      expect(ndaSignedEvents.length).to.equal(1);
      expect(ndaSignedEvents[0].args.signer).to.equal(partyB.address);
      
      const contractActivatedEvents = events.filter(e => e.name === 'ContractActivated');
      expect(contractActivatedEvents.length).to.equal(1);
      
      // Check contract state - should be Active (enum value 2)
      expect(await ndaContract.contractState()).to.equal(2);
    });

    it('should submit evidence (Merkle batch, URI, hash)', async function () {
      // Create evidence items
      const evidenceHelper = new MerkleEvidenceHelper();
      
      // Add multiple evidence items
      evidenceHelper.addEvidence({
        caseId: 1,
        contentDigest: ethers.keccak256(ethers.toUtf8Bytes('NDA Evidence content 1')),
        cidHash: ethers.keccak256(ethers.toUtf8Bytes('NDA_CID1')),
        uploader: partyA.address,
        timestamp: Math.floor(Date.now() / 1000)
      });
      
      evidenceHelper.addEvidence({
        caseId: 1,
        contentDigest: ethers.keccak256(ethers.toUtf8Bytes('NDA Evidence content 2')),
        cidHash: ethers.keccak256(ethers.toUtf8Bytes('NDA_CID2')),
        uploader: partyB.address,
        timestamp: Math.floor(Date.now() / 1000) + 1
      });
      
      // Build Merkle tree
      evidenceHelper.buildTree();
      const merkleRoot = evidenceHelper.getRoot();
      
      // Submit evidence batch
      const tx = await merkleEvidenceManager.connect(partyA).submitEvidenceBatch(
        merkleRoot,
        evidenceHelper.getAllEvidenceItems().length
      );
      const receipt = await tx.wait();
      
      // Check BatchCreated event
      const batchEvents = receipt.logs.map(log => {
        try { return merkleEvidenceManager.interface.parseLog(log); } catch { return null; }
      }).filter(e => e && e.name === 'BatchCreated');
      expect(batchEvents.length).to.equal(1);
      expect(batchEvents[0].args.merkleRoot).to.equal(merkleRoot);
      expect(batchEvents[0].args.evidenceCount).to.equal(2);
      expect(batchEvents[0].args.submitter).to.equal(partyA.address);
      
      const batchId = batchEvents[0].args.batchId;
      
      // Verify first evidence item
      const evidenceItem = evidenceHelper.getEvidenceItem(0);
      const proof = evidenceHelper.getProof(0);
      
      const verifyTx = await merkleEvidenceManager.connect(partyB).verifyEvidence(
        batchId,
        evidenceItem,
        proof
      );
      const verifyReceipt = await verifyTx.wait();
      
      // Check EvidenceVerified event
      const verifyEvents = verifyReceipt.logs.map(log => {
        try { return merkleEvidenceManager.interface.parseLog(log); } catch { return null; }
      }).filter(e => e && e.name === 'EvidenceVerified');
      expect(verifyEvents.length).to.equal(1);
      expect(verifyEvents[0].args.batchId).to.equal(batchId);
      expect(verifyEvents[0].args.caseId).to.equal(evidenceItem.caseId);
      expect(verifyEvents[0].args.cidHash).to.equal(evidenceItem.cidHash);
      expect(verifyEvents[0].args.uploader).to.equal(evidenceItem.uploader);
      
      // Check batch information
      const batch = await merkleEvidenceManager.getBatch(batchId);
      expect(batch.merkleRoot).to.equal(merkleRoot);
      expect(batch.evidenceCount).to.equal(2);
      expect(batch.submitter).to.equal(partyA.address);
      expect(batch.finalized).to.be.false;
    });

    it('should open dispute and report breach', async function () {
      // Sign and deposit to activate contract
      await ndaContract.connect(partyA).deposit({ value: minDeposit });
      await ndaContract.connect(partyB).deposit({ value: minDeposit });

      // Sign the contract
      const domain = {
        name: 'NDATemplate',
        version: '1',
        chainId: (await partyA.provider.getNetwork()).chainId,
        verifyingContract: ndaContract.target ?? ndaContract.address
      };
      const types = {
        NDA: [
          { name: 'contractAddress', type: 'address' },
          { name: 'expiryDate', type: 'uint256' },
          { name: 'penaltyBps', type: 'uint16' },
          { name: 'customClausesHash', type: 'bytes32' }
        ]
      };
      const value = {
        contractAddress: ndaContract.target ?? ndaContract.address,
        expiryDate: BigInt(expiryDate),
        penaltyBps: penaltyBps,
        customClausesHash: ethers.ZeroHash
      };

      const sigA = await partyA.signTypedData(domain, types, value);
      await ndaContract.connect(partyA).signNDA(sigA);

      const sigB = await partyB.signTypedData(domain, types, value);
      await ndaContract.connect(partyB).signNDA(sigB);

      // Now report breach
      const requestedPenalty = ethers.parseEther('0.05');
      const breachTx = await ndaContract.connect(partyA).reportBreach(
        partyB.address,
        requestedPenalty,
        ethers.ZeroHash, // evidenceHash
  'helia://breach-evidence',
        { value: ethers.parseEther('0.001') } // bond
      );
      const breachReceipt = await breachTx.wait();

      // Check BreachReported event
      const breachEvents = breachReceipt.logs.map(log => {
        try { return ndaContract.interface.parseLog(log); } catch { return null; }
      }).filter(e => e && e.name === 'BreachReported');

      expect(breachEvents.length).to.equal(1);
      const caseId = breachEvents[0].args.caseId;
      expect(breachEvents[0].args.reporter).to.equal(partyA.address);
      expect(breachEvents[0].args.offender).to.equal(partyB.address);
      expect(breachEvents[0].args.requestedPenalty).to.equal(requestedPenalty);

      // Verify case was created
      const caseData = await ndaContract.getCase(caseId);
      expect(caseData.reporter).to.equal(partyA.address);
      expect(caseData.offender).to.equal(partyB.address);
      expect(caseData.requestedPenalty).to.equal(requestedPenalty);
      expect(caseData.resolved).to.be.false;
    });

    it('should resolve dispute via ArbitrationService', async function () {
      // Sign and deposit to activate contract
      await ndaContract.connect(partyA).deposit({ value: minDeposit });
      await ndaContract.connect(partyB).deposit({ value: minDeposit });

      // Sign the contract
      const domain = {
        name: 'NDATemplate',
        version: '1',
        chainId: (await partyA.provider.getNetwork()).chainId,
        verifyingContract: ndaContract.target ?? ndaContract.address
      };
      const types = {
        NDA: [
          { name: 'contractAddress', type: 'address' },
          { name: 'expiryDate', type: 'uint256' },
          { name: 'penaltyBps', type: 'uint16' },
          { name: 'customClausesHash', type: 'bytes32' }
        ]
      };
      const value = {
        contractAddress: ndaContract.target ?? ndaContract.address,
        expiryDate: BigInt(expiryDate),
        penaltyBps: penaltyBps,
        customClausesHash: ethers.ZeroHash
      };

      const sigA = await partyA.signTypedData(domain, types, value);
      await ndaContract.connect(partyA).signNDA(sigA);

      const sigB = await partyB.signTypedData(domain, types, value);
      await ndaContract.connect(partyB).signNDA(sigB);

      // Report breach
      const requestedPenalty = ethers.parseEther('0.05');
      const breachTx = await ndaContract.connect(partyA).reportBreach(
        partyB.address,
        requestedPenalty,
        ethers.ZeroHash,
  'helia://breach-evidence',
        { value: ethers.parseEther('0.001') }
      );
      const breachReceipt = await breachTx.wait();
      const breachEvents = breachReceipt.logs.map(log => {
        try { return ndaContract.interface.parseLog(log); } catch { return null; }
      }).filter(e => e && e.name === 'BreachReported');
      const caseId = breachEvents[0].args.caseId;

      // Resolve via ArbitrationService
      const [serviceOwner] = await ethers.getSigners();
      const approvedPenalty = ethers.parseEther('0.03');
      await arbitrationService.connect(serviceOwner).applyResolutionToTarget(
        ndaContract.target,
        caseId,
        true, // approve
        approvedPenalty,
        partyA.address // beneficiary
      );

      // Verify resolution
      const resolvedCase = await ndaContract.getCase(caseId);
      expect(resolvedCase.resolved).to.be.true;
      expect(resolvedCase.approved).to.be.true;
    });

    it('should emit all relevant events', async function () {
      // Create a new NDA contract for this test
      const eventsTx = await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        penaltyBps,
        ethers.ZeroHash,
        minDeposit,
        0
      );
      const eventsReceipt = await eventsTx.wait();
      const eventsParsedLogs = eventsReceipt.logs.map(l => {
        try { return factory.interface.parseLog(l); } catch { return null; }
      });
      const eventsEvt = eventsParsedLogs.find(e => e && e.name === 'NDACreated');
      const eventsNDAContract = await ethers.getContractAt('NDATemplate', eventsEvt.args.contractAddress);
      
      // Track all events emitted during the full NDA flow
      const allEvents = [];
      
      // Helper to collect events from receipts
      const collectEvents = (receipt, contract) => {
        const events = receipt.logs.map(log => {
          try { return contract.interface.parseLog(log); } catch { return null; }
        }).filter(e => e !== null);
        allEvents.push(...events);
      };
      
      // 1. Make deposits
      const depositATx = await eventsNDAContract.connect(partyA).deposit({ value: minDeposit });
      collectEvents(await depositATx.wait(), eventsNDAContract);
      
      const depositBTx = await eventsNDAContract.connect(partyB).deposit({ value: minDeposit });
      collectEvents(await depositBTx.wait(), eventsNDAContract);
      
      // 2. Sign the contract
      const domain = {
        name: 'NDATemplate',
        version: '1',
        chainId: (await partyA.provider.getNetwork()).chainId,
        verifyingContract: eventsNDAContract.target ?? eventsNDAContract.address
      };
      const types = {
        NDA: [
          { name: 'contractAddress', type: 'address' },
          { name: 'expiryDate', type: 'uint256' },
          { name: 'penaltyBps', type: 'uint16' },
          { name: 'customClausesHash', type: 'bytes32' }
        ]
      };
      const value = {
        contractAddress: eventsNDAContract.target ?? eventsNDAContract.address,
        expiryDate: BigInt(expiryDate),
        penaltyBps: penaltyBps,
        customClausesHash: ethers.ZeroHash
      };
      
      const sigA = await partyA.signTypedData(domain, types, value);
      const signATx = await eventsNDAContract.connect(partyA).signNDA(sigA);
      collectEvents(await signATx.wait(), eventsNDAContract);
      
      const sigB = await partyB.signTypedData(domain, types, value);
      const signBTx = await eventsNDAContract.connect(partyB).signNDA(sigB);
      collectEvents(await signBTx.wait(), eventsNDAContract);
      
      // 3. Submit evidence batch
      const evidenceHelper = new MerkleEvidenceHelper();
      evidenceHelper.addEvidence({
        caseId: 1,
        contentDigest: ethers.keccak256(ethers.toUtf8Bytes('NDA Evidence content')),
        cidHash: ethers.keccak256(ethers.toUtf8Bytes('NDA_CID1')),
        uploader: partyA.address,
        timestamp: Math.floor(Date.now() / 1000)
      });
      evidenceHelper.buildTree();
      const merkleRoot = evidenceHelper.getRoot();
      
      const evidenceTx = await merkleEvidenceManager.connect(partyA).submitEvidenceBatch(
        merkleRoot,
        evidenceHelper.getAllEvidenceItems().length
      );
      collectEvents(await evidenceTx.wait(), merkleEvidenceManager);
      
      // 4. Report breach (use partyB as reporter)
      const offender = partyA.address;
      const requestedPenalty = ethers.parseEther('0.05');
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('Breach evidence'));
  const evidenceURI = 'helia://breach123';
      const disputeFee = await eventsNDAContract.disputeFee();
      
      const breachTx = await eventsNDAContract.connect(partyB).reportBreach(
        offender,
        requestedPenalty,
        evidenceHash,
        evidenceURI,
        { value: disputeFee }
      );
      collectEvents(await breachTx.wait(), eventsNDAContract);
      
      // 5. Resolve dispute
      const breachEvents = allEvents.filter(e => e.name === 'BreachReported');
      const caseId = breachEvents[0].args.caseId;
      
      const [serviceOwner] = await ethers.getSigners();
      const resolveTx = await arbitrationService.connect(serviceOwner).applyResolutionToTarget(
        eventsNDAContract.target,
        caseId,
        true, // approve
        requestedPenalty,
        partyA.address
      );
      collectEvents(await resolveTx.wait(), arbitrationService);
      collectEvents(await resolveTx.wait(), eventsNDAContract);
      
      // Verify all expected events are present
      const eventNames = allEvents.map(e => e.name);
      
      // Deposit events
      expect(eventNames).to.include('DepositMade');
      expect(eventNames.filter(name => name === 'DepositMade')).to.have.lengthOf(2);
      
      // Contract signing events
      expect(eventNames).to.include('NDASigned');
      expect(eventNames.filter(name => name === 'NDASigned')).to.have.lengthOf(2);
      expect(eventNames).to.include('ContractActivated');
      
      // Evidence events
      expect(eventNames).to.include('BatchCreated');
      
      // Dispute events
      expect(eventNames).to.include('BreachReported');
      
      // Resolution events
      expect(eventNames).to.include('ResolutionApplied');
      expect(eventNames).to.include('BreachResolved');
      
      // Verify event data consistency
      const depositEvents = allEvents.filter(e => e.name === 'DepositMade');
      expect(depositEvents[0].args.party).to.equal(partyA.address);
      expect(depositEvents[0].args.amount).to.equal(minDeposit);
      expect(depositEvents[1].args.party).to.equal(partyB.address);
      expect(depositEvents[1].args.amount).to.equal(minDeposit);
      
      const ndaSignedEvents = allEvents.filter(e => e.name === 'NDASigned');
      expect(ndaSignedEvents[0].args.signer).to.equal(partyA.address);
      expect(ndaSignedEvents[1].args.signer).to.equal(partyB.address);
      
      const batchEvents = allEvents.filter(e => e.name === 'BatchCreated');
      expect(batchEvents[0].args.merkleRoot).to.equal(merkleRoot);
      
      const breachReportedEvents = allEvents.filter(e => e.name === 'BreachReported');
      expect(breachReportedEvents[0].args.reporter).to.equal(partyB.address);
      expect(breachReportedEvents[0].args.offender).to.equal(partyA.address);
      expect(breachReportedEvents[0].args.requestedPenalty).to.equal(requestedPenalty);
      
      const resolutionEvents = allEvents.filter(e => e.name === 'ResolutionApplied');
      expect(resolutionEvents[0].args.target).to.equal(eventsNDAContract.target);
      expect(resolutionEvents[0].args.caseId).to.equal(caseId);
      
      const breachResolvedEvents = allEvents.filter(e => e.name === 'BreachResolved');
      expect(breachResolvedEvents[0].args.caseId).to.equal(caseId);
      expect(breachResolvedEvents[0].args.approved).to.be.true;
      expect(breachResolvedEvents[0].args.appliedPenalty).to.equal(requestedPenalty);
    });

    it('should handle edge cases', async function () {
      // First set up a valid NDA contract
      await ndaContract.connect(partyA).deposit({ value: minDeposit });
      await ndaContract.connect(partyB).deposit({ value: minDeposit });
      
      const domain = {
        name: 'NDATemplate',
        version: '1',
        chainId: (await partyA.provider.getNetwork()).chainId,
        verifyingContract: ndaContract.target ?? ndaContract.address
      };
      const types = {
        NDA: [
          { name: 'contractAddress', type: 'address' },
          { name: 'expiryDate', type: 'uint256' },
          { name: 'penaltyBps', type: 'uint16' },
          { name: 'customClausesHash', type: 'bytes32' }
        ]
      };
      const value = {
        contractAddress: ndaContract.target ?? ndaContract.address,
        expiryDate: BigInt(expiryDate),
        penaltyBps: penaltyBps,
        customClausesHash: ethers.ZeroHash
      };
      
      const sigA = await partyA.signTypedData(domain, types, value);
      await ndaContract.connect(partyA).signNDA(sigA);
      const sigB = await partyB.signTypedData(domain, types, value);
      await ndaContract.connect(partyB).signNDA(sigB);
      
      // Test 1: Non-party cannot report breach
      await expect(
        ndaContract.connect(landlord).reportBreach(
          partyB.address, 
          ethers.parseEther('0.01'), 
          ethers.keccak256(ethers.toUtf8Bytes('test')), 
          'helia://test'
        )
      ).to.be.revertedWith('Only party');
      
      // Test 2: Cannot report breach against self
      await expect(
        ndaContract.connect(partyA).reportBreach(
          partyA.address, 
          ethers.parseEther('0.01'), 
          ethers.keccak256(ethers.toUtf8Bytes('test')), 
          'helia://test'
        )
      ).to.be.revertedWith('Cannot accuse self');
      
      // Test 3: Cannot report breach with zero penalty
      await expect(
        ndaContract.connect(partyA).reportBreach(
          partyB.address, 
          0, 
          ethers.keccak256(ethers.toUtf8Bytes('test')), 
          'helia://test'
        )
      ).to.be.revertedWith('Requested penalty must be > 0');
      
      // Test 4: Valid breach reporting
      const validPenalty = ethers.parseEther('0.01');
      const validBreachTx = await ndaContract.connect(partyA).reportBreach(
        partyB.address,
        validPenalty,
        ethers.keccak256(ethers.toUtf8Bytes('valid breach')),
  'helia://valid-breach',
        { value: ethers.parseEther('0.001') }
      );
      const validBreachReceipt = await validBreachTx.wait();
      const validBreachEvents = validBreachReceipt.logs.map(log => {
        try { return ndaContract.interface.parseLog(log); } catch { return null; }
      }).filter(e => e && e.name === 'BreachReported');
      expect(validBreachEvents.length).to.equal(1);
      const validCaseId = validBreachEvents[0].args.caseId;

      // Test 5: Cannot resolve already resolved dispute
      const [serviceOwner] = await ethers.getSigners();
      await arbitrationService.connect(serviceOwner).applyResolutionToTarget(
        ndaContract.target,
        validCaseId,
        true,
        validPenalty,
        partyA.address
      );

      // Try to resolve again - should fail
      await expect(
        arbitrationService.connect(serviceOwner).applyResolutionToTarget(
          ndaContract.target,
          validCaseId,
          false,
          0,
          partyB.address
        )
      ).to.be.reverted; // Should fail due to replay protection

      // Test 6: Invalid case ID access
      await expect(
        ndaContract.getCase(999)
      ).to.be.revertedWith('Case does not exist');
      
      // Test 7: Cannot report breach on inactive contract
      // First need a new contract for this test
      const newTx = await factory.connect(partyA).createNDA(
        partyB.address,
        expiryDate,
        penaltyBps,
        ethers.ZeroHash,
        minDeposit,
        0
      );
      const newReceipt = await newTx.wait();
      const newParsedLogs = newReceipt.logs.map(l => {
        try { return factory.interface.parseLog(l); } catch { return null; }
      });
      const newEvt = newParsedLogs.find(e => e && e.name === 'NDACreated');
      const newNDAContract = await ethers.getContractAt('NDATemplate', newEvt.args.contractAddress);
      
      // Don't activate this contract - it should be inactive
      await expect(
        newNDAContract.connect(partyA).reportBreach(
          partyB.address, 
          ethers.parseEther('0.01'), 
          ethers.keccak256(ethers.toUtf8Bytes('test')), 
          'helia://test'
        )
      ).to.be.revertedWith('Must be active');
      
      // Test 8: Cannot deposit below minimum
      const insufficientDeposit = minDeposit - ethers.parseEther('0.01');
      await expect(
        newNDAContract.connect(partyA).deposit({ value: insufficientDeposit })
      ).to.be.revertedWith('Deposit below minimum');
    });
  });

  // Add more describe/it blocks for edge cases, events, and integration as needed
});

// Backend integration test skeletons

describe('Backend Integration', function () {
  // You can use supertest or axios for HTTP requests
  // Example: const request = require('supertest');
  // const api = request('http://localhost:3001');

  it('should submit evidence to backend and receive digest', async function () {
    // TODO: Simulate evidence submission to backend REST endpoint
    // Example:
    // const res = await api.post('/api/evidence').send({ ... });
    // expect(res.status).to.equal(200);
    // expect(res.body.digest).to.be.a('string');
  });

  it('should trigger arbitration via backend and receive decision', async function () {
    // TODO: Simulate dispute trigger to backend arbitration endpoint
    // Example:
    // const res = await api.post('/api/arbitrate').send({ ... });
    // expect(res.status).to.equal(200);
    // expect(res.body.decision).to.have.property('approved');
  });

  it('should fetch dispute history from backend', async function () {
    // TODO: Simulate fetching dispute history
    // Example:
    // const res = await api.get('/api/disputes?contract=0x...');
    // expect(res.status).to.equal(200);
    // expect(res.body.cases).to.be.an('array');
  });

  it('should validate evidence digest against Helia', async function () {
    // TODO: Simulate evidence digest validation
    // Example:
    // const res = await api.post('/api/evidence/validate').send({ digest: '...' });
    // expect(res.status).to.equal(200);
    // expect(res.body.valid).to.be.true;
  });

  it('should return backend health status', async function () {
    // TODO: Simulate health check endpoint
    // Example:
    // const res = await api.get('/api/health');
    // expect(res.status).to.equal(200);
    // expect(res.body.status).to.equal('ok');
  });

  it('should upload NDA custom clauses to Helia and return CID', async function () {
    // TODO: Simulate uploading NDA custom clauses to Helia via backend
    // Example:
    // const customClauses = 'Confidentiality, Non-compete, No solicitation';
    // const res = await api.post('/api/helia/upload').send({ content: customClauses });
    // expect(res.status).to.equal(200);
    // expect(res.body.cid).to.be.a('string');
  // Optionally: fetch from Helia and verify content matches
  });
});
