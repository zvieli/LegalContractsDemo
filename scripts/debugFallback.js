import pkg from 'hardhat';
const { ethers } = pkg;

async function main() {
  const [landlord, tenant] = await ethers.getSigners();
  const MerkleEvidenceManager = await ethers.getContractFactory('MerkleEvidenceManager');
  const merkleEvidenceManager = await MerkleEvidenceManager.deploy();
  await merkleEvidenceManager.waitForDeployment();

  const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
  const arbitrationService = await ArbitrationService.deploy();
  await arbitrationService.waitForDeployment();

  const MockV3Aggregator = await ethers.getContractFactory('MockV3Aggregator');
  const initialAnswer = BigInt(3000) * BigInt(10 ** 8);
  const mockPriceFeed = await MockV3Aggregator.deploy(8, initialAnswer);
  await mockPriceFeed.waitForDeployment();

  const Factory = await ethers.getContractFactory('ContractFactory');
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  await factory.setDefaultArbitrationService(arbitrationService.target);
  await factory.setMerkleEvidenceManager(merkleEvidenceManager.target);

  const rentAmount = ethers.parseEther('1.0');
  const dueDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  const propertyId = 999;

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

  // sign terms
  const domain = { name: 'TemplateRentContract', version: '1', chainId: (await landlord.provider.getNetwork()).chainId, verifyingContract: rentContract.target ?? rentContract.address };
  const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
  const value = { contractAddress: rentContract.target ?? rentContract.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };
  await rentContract.connect(landlord).signRent(await landlord.signTypedData(domain, types, value));
  await rentContract.connect(tenant).signRent(await tenant.signTypedData(domain, types, value));

  // deploy FailReceiver
  const Fail = await ethers.getContractFactory('FailReceiver');
  const fail = await Fail.deploy();
  await fail.waitForDeployment();

  // tenant pays full into escrow
  const full = ethers.parseEther('1.0');
  const txPay = await rentContract.connect(tenant).payRentInEth({ value: full });
  await txPay.wait();
  console.log('escrow after pay:', (await rentContract.escrowBalance()).toString());

  // landlord reports dispute requesting 0.5
  const requested = ethers.parseEther('0.5');
  const percentageBond = (requested * 50n) / 10000n;
  const minBond = ethers.parseEther('0.001');
  const requiredBond = percentageBond > minBond ? percentageBond : minBond;
  const txReport = await rentContract.connect(landlord).reportDispute(0, requested, 'ipfs://z', { value: requiredBond });
  await txReport.wait();

  // apply resolution
  const txRes = await arbitrationService.connect(landlord).applyResolutionToTarget(rentContract.target ?? rentContract.address, 0, true, requested, fail.target ?? fail.address);
  const r = await txRes.wait();
  console.log('resolution tx logs:');
  for (const l of r.logs) {
    try {
      console.log(factory.interface.parseLog(l));
    } catch (e) {}
    try { console.log(arbitrationService.interface.parseLog(l)); } catch (e) {}
    try { console.log(rentContract.interface.parseLog(l)); } catch (e) {}
    try { console.log('raw topic0', l.topics[0]); } catch(e){}
  }

  console.log('escrow after resolution:', (await rentContract.escrowBalance()).toString());
  console.log('withdrawable fail:', (await rentContract.withdrawable(fail.target ?? fail.address)).toString());
}

main().catch(e => { console.error(e); process.exitCode = 1; });
