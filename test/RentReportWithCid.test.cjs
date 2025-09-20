const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('TemplateRentContract - reportDisputeWithCid', function () {
  let accounts;
  let landlord, tenant, other;
  let TemplateRent, template;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    landlord = accounts[0];
    tenant = accounts[1];
    other = accounts[2];

    TemplateRent = await ethers.getContractFactory('TemplateRentContract');
    // constructor params: landlord, tenant, rentAmount, priceFeed, propertyId, arbitrationService, requiredDeposit, dueDate
  template = await TemplateRent.deploy(landlord.address, tenant.address, 1000, ethers.ZeroAddress, 1, ethers.ZeroAddress, 0, 0);
  await template.waitForDeployment();
  });

  it('stores evidenceCid when reportDisputeWithCid is called', async function () {
    // Call from tenant
    const dtype = 0; // Damage
  const requestedAmount = 1;
    const evidence = 'some evidence text';
    const cid = 'QmTestCid1234567890';

    // connect as tenant
    const tpl = template.connect(tenant);
    const tx = await tpl.reportDisputeWithCid(dtype, requestedAmount, evidence, cid, { value: 0 });
    await tx.wait();

    const caseId = 0;
    const dispute = await template.getDisputeWithCid(caseId);
    expect(dispute[3]).to.equal(evidence);
    expect(dispute[4]).to.equal(cid);
  });
});
