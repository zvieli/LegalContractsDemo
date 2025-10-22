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

  const ABIDecision = [
    'bytes32', 'bool', 'uint256', 'address', 'string', 'bytes32', 'uint256', 'address', 'uint256'
  ];
  const disputeId = ethers.id('d2');
  const messageId = ethers.id('message-ccip-raw-1');
  const decisionTuple = [disputeId, true, requested, landlord.address, 'ok', ethers.id('oracleX'), Math.floor(Date.now() / 1000), rentContract.target ?? rentContract.address, 0];
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(ABIDecision, decisionTuple);

  try {
    // use callStatic to get revert reason
    await arbitrationService.callStatic.receiveCCIPDecisionRaw(messageId, rentContract.target ?? rentContract.address, 0, encoded);
    console.log('staticcall returned successfully (unexpected)');
  } catch (err) {
    console.error('staticcall revert:', err.message || err);
    if (err.error && err.error.message) console.error('inner:', err.error.message);
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
