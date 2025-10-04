import hre from 'hardhat';
import { keccak256, toUtf8Bytes, parseEther } from 'ethers';

export async function deployArbitrationStack(requiredDeposit = parseEther('0.5')) {
  const { ethers } = hre;
  const [admin, landlord, tenant] = await ethers.getSigners();
  const Arb = await ethers.getContractFactory('ArbitrationService');
  const arbitrationService = await Arb.connect(admin).deploy();
  await arbitrationService.waitForDeployment();
  const Fac = await ethers.getContractFactory('ContractFactory');
  const factory = await Fac.connect(admin).deploy();
  await factory.waitForDeployment();
  await (await arbitrationService.connect(admin).setFactory(await factory.getAddress())).wait();
  if (factory.setDefaultArbitrationService) {
    await (await factory.connect(admin).setDefaultArbitrationService(await arbitrationService.getAddress(), requiredDeposit)).wait();
  }
  return { admin, landlord, tenant, arbitrationService, factory };
}

export async function createRentContract(factory, landlord, tenant, rentAmount, priceFeed, propertyId = 12345, dueDateOverload = false) {
  const fnSig = dueDateOverload ? 'createRentContract(address,uint256,address,uint256,uint256)' : 'createRentContract(address,uint256,address,uint256)';
  const createFn = factory.connect(landlord)[fnSig];
  const tx = await createFn(tenant.address, rentAmount, priceFeed, propertyId);
  const rc = await tx.wait();
  let rentAddr;
  for (const log of rc.logs) {
    try { const parsed = factory.interface.parseLog(log); if (parsed.name === 'RentContractCreated') { rentAddr = parsed.args[0]; break; } } catch(_) {}
  }
  if (!rentAddr) throw new Error('RentContractCreated not found');
  const { ethers } = hre;
  const rentContract = await ethers.getContractAt('TemplateRentContract', rentAddr);
  return rentContract;
}

export async function signRent(rentContract, landlord, tenant, rentAmount) {
  const { ethers } = hre;
  const net = await ethers.provider.getNetwork();
  const domain = { name: 'TemplateRentContract', version: '1', chainId: Number(net.chainId), verifyingContract: rentContract.target };
  const types = { RENT:[{name:'contractAddress',type:'address'},{name:'landlord',type:'address'},{name:'tenant',type:'address'},{name:'rentAmount',type:'uint256'},{name:'dueDate',type:'uint256'}]};
  const value = { contractAddress: rentContract.target, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate: 0n };
  const sigL = await landlord.signTypedData(domain, types, value); await (await rentContract.connect(landlord).signRent(sigL)).wait();
  const sigT = await tenant.signTypedData(domain, types, value); await (await rentContract.connect(tenant).signRent(sigT)).wait();
  return true;
}

export async function reportDispute(rentContract, reporter, requestedWei, evidenceCid) {
  const bond = requestedWei / 2000n + 1n;
  const tx = await rentContract.connect(reporter).reportDispute(0, requestedWei, `ipfs://${evidenceCid}`, { value: bond });
  const rc = await tx.wait();
  let caseId;
  for (const log of rc.logs) { try { const p = rentContract.interface.parseLog(log); if (p.name === 'DisputeReported') { caseId = Number(p.args[0]); break; } } catch(_){} }
  if (caseId === undefined) throw new Error('caseId not found');
  return { caseId, bond };
}

export function cidDigest(cid) { return keccak256(toUtf8Bytes(cid)); }
