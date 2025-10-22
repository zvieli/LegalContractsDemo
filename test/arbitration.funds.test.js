import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('Arbitration funds: access, payout order, outstanding judgment, fallback', function () {
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

  describe('funding flows', function () {
    let rentContract, rentAmount, dueDate, propertyId;

    beforeEach(async function () {
      rentAmount = ethers.parseEther('1.0');
      dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
      propertyId = 999;

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
      rentContract = await ethers.getContractAt('EnhancedRentContract', evt.args.contractAddress);
      // sign core terms (EIP-712) so onlyFullySigned modifiers pass
      const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
      const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
      const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
      await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
      await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));
    });

    it('only arbitrationService can call resolveDisputeFinal', async function () {
      // create dispute
      await expect(rentContract.connect(landlord).reportDispute(0, ethers.parseEther('0.1'), 'ipfs://x', { value: ethers.parseEther('0.001') })).to.emit(rentContract, 'DisputeFiled');
      const caseId = 0;

      // non-arbitrator calling resolve should revert with custom error
      await expect(rentContract.connect(landlord).resolveDisputeFinal(caseId, true, ethers.parseEther('0.1'), landlord.address, 'ok', 'r'))
        .to.be.revertedWithCustomError(rentContract, 'OnlyArbitrator');

      // arbitrator can call (simulate empty resolution: 0 applied) — use the configured landlord deployer as owner
      const tx0 = await arbitrationService.connect(landlord).applyResolutionToTarget(rentContract.target ?? rentContract.address, caseId, true, ethers.parseEther('0.0'), landlord.address);
      await tx0.wait();
    });

    it('payout order: consume partyDeposit then escrow then record outstanding judgement', async function () {
      // prepare: tenant deposits partial deposit (0.5 ETH) and pays 0.3 ETH into escrow
      const partialDeposit = ethers.parseEther('0.5');
      const escrowPay = ethers.parseEther('0.3');
      await rentContract.connect(tenant).depositSecurity({ value: partialDeposit });
      await rentContract.connect(tenant).payRentPartial({ value: escrowPay });

      // landlord reports dispute requesting 1.2 ETH
      const requested = ethers.parseEther('1.2');
      // compute minimal bond per contract logic
      const percentageBond = (requested * 50n) / 10000n;
      const minBond = ethers.parseEther('0.001');
      const requiredBond = percentageBond > minBond ? percentageBond : minBond;
      await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://y', { value: requiredBond });

      // apply resolution approving full requested amount via arbitrationService
  // the arbitration service owner equals the deployer (landlord in our test fixtures)
  const tx1 = await arbitrationService.connect(landlord).applyResolutionToTarget(rentContract.target ?? rentContract.address, 0, true, requested, landlord.address);
  await tx1.wait();

      // after resolution: partyDeposit should be 0, escrow 0, outstandingJudgement == requested - available
      const depositAfter = await rentContract.partyDeposit(tenant.address);
      expect(depositAfter).to.equal(0);
      const escrowAfter = await rentContract.escrowBalance();
      expect(escrowAfter).to.equal(0);
      const escrowBefore = escrowPay;
      const available = partialDeposit + escrowBefore;
      const expectedRemaining = requested - available;
      const oj = await rentContract.outstandingJudgement(0);
      expect(oj).to.equal(expectedRemaining);
    });

    it('transfer fallback: beneficiary that rejects ETH triggers withdrawable credit', async function () {
      // deploy FailReceiver
      const Fail = await ethers.getContractFactory('FailReceiver');
      const fail = await Fail.deploy();
      await fail.waitForDeployment();

  // tenant deposits full amount into escrow
      const full = ethers.parseEther('1.0');
      await rentContract.connect(tenant).payRentInEth({ value: full });

      // landlord reports dispute requesting 0.5 and arbitrator approves sending to fail contract
      const requested = ethers.parseEther('0.5');
      const percentageBond = (requested * 50n) / 10000n;
      const minBond = ethers.parseEther('0.001');
      const requiredBond = percentageBond > minBond ? percentageBond : minBond;
      await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://z', { value: requiredBond });

      // resolve with beneficiary = fail contract which will revert on receive
  // use the configured arbitration owner (landlord) to apply the resolution
  const tx2 = await arbitrationService.connect(landlord).applyResolutionToTarget(rentContract.target ?? rentContract.address, 0, true, requested, fail.target ?? fail.address);
  await tx2.wait();

  // since transfer failed, withdrawable[fail] should be credited and escrow reduced by applied amount
  const w = await rentContract.withdrawable(fail.target ?? fail.address);
  const escrowAfter = await rentContract.escrowBalance();
  const expectedEscrowAfter = full - requested;
  expect(escrowAfter).to.equal(expectedEscrowAfter);
  expect(w).to.equal(requested);
    });
  });
});
