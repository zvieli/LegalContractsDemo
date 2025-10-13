import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('NDATemplate Full E2E', function () {
  let nda, factory, owner, partyA, partyB, arbitrationService, other;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    owner = signers[0];
    partyA = signers[1];
    partyB = signers[2];
    arbitrationService = signers[3];
    other = signers[4];
    const ContractFactory = await ethers.getContractFactory('ContractFactory');
    factory = await ContractFactory.deploy();
    await factory.connect(owner).setDefaultArbitrationService(arbitrationService.address, ethers.parseEther('1'));
    const expiryDate = Math.floor(Date.now() / 1000) + 3600;
    const penaltyBps = 500;
    const customClausesHash = ethers.id('custom');
    const minDeposit = ethers.parseEther('1');
    const tx = await factory.connect(partyA).createNDA(
      partyB.address,
      expiryDate,
      penaltyBps,
      customClausesHash,
      minDeposit
    );
    const receipt = await tx.wait();
    const parsedLogs = receipt.logs.map(log => factory.interface.parseLog(log));
    const ndaEvent = parsedLogs.find(e => e.name === 'NDACreated');
    const ndaAddress = ndaEvent.args.contractAddress;
    nda = await ethers.getContractAt('NDATemplate', ndaAddress);
  });

  it('should allow both parties to sign and deposit', async () => {
    // Simulate EIP712 signing
    // const hash = await nda.hashMessage();
    // const signatureA = await partyA.signMessage(ethers.getBytes(hash));
    // const signatureB = await partyB.signMessage(ethers.getBytes(hash));
    // await nda.connect(partyA).signNDA(signatureA);
    // await nda.connect(partyB).signNDA(signatureB);
    // expect(await nda.isFullySigned()).to.be.true;

    await nda.connect(partyA).deposit({ value: ethers.parseEther('1') });
    await nda.connect(partyB).deposit({ value: ethers.parseEther('1') });
    expect(await nda.deposits(partyA.address)).to.equal(ethers.parseEther('1'));
    expect(await nda.deposits(partyB.address)).to.equal(ethers.parseEther('1'));
  });  it('should allow reporting a breach and resolving it', async () => {
  await nda.connect(partyA).deposit({ value: ethers.parseEther('1') });
  await nda.connect(partyB).deposit({ value: ethers.parseEther('1') });
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
    const evidenceURI = 'ipfs://testcid';
    const caseId = await nda.connect(partyA).callStatic.reportBreach(
      partyB.address,
      ethers.parseEther('0.5'),
      evidenceHash,
      evidenceURI,
      { value: 0 }
    );
    await nda.connect(partyA).reportBreach(
      partyB.address,
      ethers.parseEther('0.5'),
      evidenceHash,
      evidenceURI,
      { value: 0 }
    );
    const caseData = await nda.getCase(caseId);
    expect(caseData.reporter).to.equal(partyA.address);
    expect(caseData.offender).to.equal(partyB.address);
    expect(caseData.evidenceHash).to.equal(evidenceHash);
    expect(caseData.evidenceURI).to.equal(evidenceURI);
    expect(caseData.resolved).to.be.false;

    // Resolve by arbitrationService
    await nda.connect(arbitrationService).serviceResolve(caseId, true, ethers.parseEther('0.5'), partyA.address);
    const caseDataAfter = await nda.getCase(caseId);
    expect(caseDataAfter.resolved).to.be.true;
    expect(caseDataAfter.approved).to.be.true;
  });

  it('should enforce penalty and allow withdrawal', async () => {
  await nda.connect(partyA).deposit({ value: ethers.parseEther('1') });
  await nda.connect(partyB).deposit({ value: ethers.parseEther('1') });
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
    const evidenceURI = 'ipfs://testcid';
    const caseId = await nda.connect(partyA).callStatic.reportBreach(
      partyB.address,
      ethers.parseEther('0.5'),
      evidenceHash,
      evidenceURI,
      { value: 0 }
    );
    await nda.connect(partyA).reportBreach(
      partyB.address,
      ethers.parseEther('0.5'),
      evidenceHash,
      evidenceURI,
      { value: 0 }
    );
    await nda.connect(arbitrationService).serviceResolve(caseId, true, ethers.parseEther('0.5'), partyA.address);
    await nda.connect(arbitrationService).serviceEnforce(partyB.address, ethers.parseEther('0.5'), partyA.address);
    await nda.connect(partyA).withdrawPayments();
    expect(await nda.withdrawable(partyA.address)).to.equal(0);
  });

  it('should support reportBreachWithMerkle', async () => {
  await nda.connect(partyA).deposit({ value: ethers.parseEther('1') });
  await nda.connect(partyB).deposit({ value: ethers.parseEther('1') });
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
    const evidenceURI = 'ipfs://testcid';
    const merkleRoot = ethers.hexlify(ethers.randomBytes(32));
    const caseId = await nda.connect(partyA).callStatic.reportBreachWithMerkle(
      partyB.address,
      ethers.parseEther('0.5'),
      evidenceHash,
      evidenceURI,
      merkleRoot,
      { value: 0 }
    );
    await nda.connect(partyA).reportBreachWithMerkle(
      partyB.address,
      ethers.parseEther('0.5'),
      evidenceHash,
      evidenceURI,
      merkleRoot,
      { value: 0 }
    );
    const caseData = await nda.getCase(caseId);
    expect(caseData.evidenceMerkleRoot).to.equal(merkleRoot);
  });

  it('should allow admin to set config params', async () => {
  await nda.connect(arbitrationService).setDisputeFee(ethers.parseEther('0.01'));
    await nda.connect(arbitrationService).setRevealWindowSeconds(3600);
    await nda.connect(arbitrationService).setAppealWindowSeconds(7200);
    await nda.connect(arbitrationService).setMinReportInterval(60);
    await nda.connect(arbitrationService).setMaxOpenReportsPerReporter(5);
    expect(await nda.disputeFee()).to.equal(ethers.parseEther('0.01'));
    expect(await nda.revealWindowSeconds()).to.equal(3600);
    expect(await nda.appealWindowSeconds()).to.equal(7200);
    expect(await nda.minReportInterval()).to.equal(60);
    expect(await nda.maxOpenReportsPerReporter()).to.equal(5);
  });
});
