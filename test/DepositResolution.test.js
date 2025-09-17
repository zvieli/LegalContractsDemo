import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

// EIP712 sign helper (copied pattern from RentContract tests)
async function signRent(signer, contract, landlord, tenant, rentAmount, dueDate) {
  const domain = {
    name: 'TemplateRentContract',
    version: '1',
    chainId: (await signer.provider.getNetwork()).chainId,
    verifyingContract: contract.target
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
    contractAddress: contract.target,
    landlord,
    tenant,
    rentAmount,
    dueDate
  };
  return await signer.signTypedData(domain, types, value);
}

describe('TemplateRentContract deposit-based dispute resolution', function () {
  let owner, landlord, tenant, other;
  let Template, template;
  let ArbitrationService, arbSvc;

  beforeEach(async function () {
    [owner, landlord, tenant, other] = await ethers.getSigners();
  Template = await ethers.getContractFactory('TemplateRentContract');
  // deploy a simple price feed mock address (use zero address where not used in tests)
  const priceFeed = other.address;
  // Deploy Template with owner EOA as the arbitrationService so tests can call resolveDisputeFinal directly
  template = await Template.deploy(landlord.address, tenant.address, 1, priceFeed, 0, owner.address, 0);
  await template.waitForDeployment();

  // both parties sign so deposits allowed
  const dueDate = await template.dueDate();
  const rentAmt = await template.rentAmount();
  const sigL = await signRent(landlord, template, landlord.address, tenant.address, rentAmt, dueDate);
  await template.connect(landlord).signRent(sigL);
  const sigT = await signRent(tenant, template, landlord.address, tenant.address, rentAmt, dueDate);
  await template.connect(tenant).signRent(sigT);
  });

  it('full deposit covers requested amount -> debit and transfer', async function () {
  // landlord (debtor) deposits 1 ETH via depositSecurity()
  await template.connect(landlord).depositSecurity({ value: ethers.parseEther('1') });
  // confirm deposit recorded
  const ldDep = await template.partyDeposit(landlord.address);
  expect(ldDep).to.equal(ethers.parseEther('1'));

  // report a dispute by tenant requesting 0.5 ETH (debtor will be landlord)
  await template.connect(tenant).reportDispute(0, ethers.parseEther('0.5'), ethers.ZeroHash);
  // call arbitration helper to apply resolution (owner calls service)
  // Owner acts as arbitrationService (constructor set owner.address) and calls resolveDisputeFinal
  await template.connect(owner).resolveDisputeFinal(0, true, ethers.parseEther('0.5'), tenant.address, '', '');

  // after resolution, landlord's deposit should be debited by 0.5
  const ldDepAfter = await template.partyDeposit(landlord.address);
  expect(ldDepAfter).to.equal(ethers.parseEther('0.5'));
  // no debt recorded against landlord
  const debt = await template.debtOwed(landlord.address);
  expect(debt).to.equal(0);
  });

  it('partial deposit -> debit partial and record remainder as debt', async function () {
  // landlord (debtor) deposits 0.2 ETH via depositSecurity()
  await template.connect(landlord).depositSecurity({ value: ethers.parseEther('0.2') });
  const ldDep2 = await template.partyDeposit(landlord.address);
  expect(ldDep2).to.equal(ethers.parseEther('0.2'));

  // tenant reports dispute requesting 0.5 ETH (debtor=landlord)
  await template.connect(tenant).reportDispute(0, ethers.parseEther('0.5'), ethers.ZeroHash);
  await expect(
    template.connect(owner).resolveDisputeFinal(0, true, ethers.parseEther('0.5'), tenant.address, '', '')
  ).to.be.revertedWithCustomError(template, 'InsufficientDepositForResolution').withArgs(ethers.parseEther('0.2'), ethers.parseEther('0.5'));
  });

  it('no deposit -> full amount recorded as debt', async function () {
  // no deposit by landlord (debtor)
  const dep = await template.partyDeposit(landlord.address);
  expect(dep).to.equal(0);

  await template.connect(tenant).reportDispute(0, ethers.parseEther('0.4'), ethers.ZeroHash);
  await expect(
    template.connect(owner).resolveDisputeFinal(0, true, ethers.parseEther('0.4'), tenant.address, '', '')
  ).to.be.revertedWithCustomError(template, 'InsufficientDepositForResolution').withArgs(0, ethers.parseEther('0.4'));
  });
});
