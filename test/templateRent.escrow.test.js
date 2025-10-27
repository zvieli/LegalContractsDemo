import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('EnhancedRentContract - escrow & arbitration funds', function () {
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

  describe('escrow and resolution', function () {
    let rentContract, rentAmount, dueDate, propertyId;

    beforeEach(async function () {
      rentAmount = ethers.parseEther('1.0');
      dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // +1 day
      propertyId = 42;

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
      rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);
    });

    it('releases escrow to landlord when term completes', async function () {
      // sign both parties
      // NOTE: The runtime instance is `EnhancedRentContract` (created by the Factory)
      // but the EIP-712 domain name MUST match the contract's `CONTRACT_NAME` constant
      // which is defined in `TemplateRentContract.sol` as "TemplateRentContract".
      // EnhancedRentContract inherits the same EIP-712 name, so tests must use
      // 'TemplateRentContract' here to produce valid signatures.
      const domain = {
        name: 'TemplateRentContract',
        version: '1',
        chainId: (await landlord.provider.getNetwork()).chainId,
        verifyingContract: rentContract.target ?? rentContract.address
      };
      const types = { RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ] };
      const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
      const sigL = await landlord.signTypedData(domain, types, value);
      await expect(rentContract.connect(landlord).signRent(sigL)).to.emit(rentContract, 'RentSigned');
      const sigT = await tenant.signTypedData(domain, types, value);
      await expect(rentContract.connect(tenant).signRent(sigT)).to.emit(rentContract, 'RentSigned');

      // tenant pays rent into escrow
      await expect(rentContract.connect(tenant).payRentInEth({ value: rentAmount })).to.emit(rentContract, 'RentPaid');

      expect(await rentContract.escrowBalance()).to.equal(rentAmount);

      // advance time past dueDate
      const increase = Math.max(1, dueDate - Math.floor(Date.now() / 1000) + 1);
      await landlord.provider.send('evm_increaseTime', [increase]);
      await landlord.provider.send('evm_mine');

      // call releaseOnTerm and assert escrow cleared and contract inactive
      await rentContract.connect(landlord).releaseOnTerm();
      expect(await rentContract.escrowBalance()).to.equal(0);
      expect(await rentContract.active()).to.equal(false);
    });

    it('finalize mutual cancellation gives escrow to initiator', async function () {
      // sign both
  const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
      const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
      const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
      await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
      await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

      // tenant deposits escrow
      const topUp = ethers.parseEther('0.2');
      await rentContract.connect(tenant).payRentPartial({ value: topUp });
      expect(await rentContract.escrowBalance()).to.equal(topUp);

      // Initiate cancellation by tenant, landlord approves
      await rentContract.connect(tenant).initiateCancellation();
      await rentContract.connect(landlord).approveCancellation();

      // finalize mutual cancellation
      await rentContract.connect(landlord).finalizeMutualCancellation();
      expect(await rentContract.escrowBalance()).to.equal(0);
      expect(await rentContract.active()).to.equal(false);
    });

    it('records outstanding judgement when award exceeds available funds', async function () {
      // sign both
  const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
      const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
      const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
      await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
      await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

      // Tenant pays 1 ETH into escrow
      await rentContract.connect(tenant).payRentInEth({ value: rentAmount });
      expect(await rentContract.escrowBalance()).to.equal(rentAmount);

      // Reporter (landlord) files dispute requesting 2 ETH (greater than escrow)
      const requested = ethers.parseEther('2.0');
      // compute bond minimal - send a small bond to satisfy requiredBond (reportDispute enforces a bond)
      const bond = ethers.parseEther('0.01');
      const tx = await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://cid', { value: bond });
      const receipt = await tx.wait();
      const parsed = receipt.logs.map(l => { try { return rentContract.interface.parseLog(l); } catch { return null; } });
  const filed = parsed.find(e => e && e.name === 'DisputeFiled');
  const caseId = filed.args.caseId; // keep as BigInt/ethers numeric type

      // Ensure available funds < requested
      const escrow = await rentContract.escrowBalance();
      const deposit = await rentContract.partyDeposit(tenant.address);
      expect(escrow + deposit).to.be.lessThan(requested);

  // Call arbitration service to apply resolution approving the requested amount
  // Use the default first signer as the owner (deployer)
  const [owner] = await ethers.getSigners();
  // Apply resolution via arbitrationService (approve=true)
  await arbitrationService.connect(owner).applyResolutionToTarget(rentContract.target ?? rentContract.address, caseId, true, requested, landlord.address);

      // After resolution, escrow should be consumed and outstandingJudgement recorded for remainder
      const afterEscrow = await rentContract.escrowBalance();
      expect(afterEscrow).to.equal(0);
      const oj = await rentContract.outstandingJudgement(caseId);
      // outstanding judgement should equal requested - available (escrow+deposit)
      const available = escrow + deposit;
      const expectedRemaining = requested - available;
      expect(oj).to.equal(expectedRemaining);
    });

    it('allows debtor to depositForCase and satisfy deposit before resolution', async function () {
      // sign both
  const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
      const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
      const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
      await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
      await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

      // landlord files dispute requesting 0.5 ETH
      const requested = ethers.parseEther('0.5');
  // compute bond per contract logic: percentageBond = requested * 50 / 10000; min=0.001
  const percentageBond = (requested * 50n) / 10000n;
  const minBond = ethers.parseEther('0.001');
  const requiredBond = percentageBond > minBond ? percentageBond : minBond;
  const tx = await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://c2', { value: requiredBond });
      const receipt = await tx.wait();
      const parsed = receipt.logs.map(l => { try { return rentContract.interface.parseLog(l); } catch { return null; } });
      const filed = parsed.find(e => e && e.name === 'DisputeFiled');
      const caseId = filed.args.caseId;

      // Tenant deposits for the case
      const depositAmount = requested;
      await rentContract.connect(tenant).depositForCase(caseId, { value: depositAmount });

      // Now apply resolution approving the requested amount
      const [owner] = await ethers.getSigners();
      await arbitrationService.connect(owner).applyResolutionToTarget(rentContract.target ?? rentContract.address, caseId, true, requested, landlord.address);

      // The partyDeposit for tenant should be zero (consumed)
      const remainingDeposit = await rentContract.partyDeposit(tenant.address);
      expect(remainingDeposit).to.equal(0);
      const oj = await rentContract.outstandingJudgement(caseId);
      expect(oj).to.equal(0);
    });
  });
});
