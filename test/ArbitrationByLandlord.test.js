import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

describe('ArbitrationService.finalizeByLandlord', function () {
  let owner, landlord, tenant, other;
  let ArbitrationService, svc;
  let Rent, rent;

  beforeEach(async function () {
    [owner, landlord, tenant, other] = await ethers.getSigners();
      // Deploy arbitration service using raw artifact to avoid factory wrapper issues in this test
      const arbArtifact = await pkg.artifacts.readArtifact('ArbitrationService');
      const ArbFactory = new ethers.ContractFactory(arbArtifact.abi, arbArtifact.bytecode, owner);
      try {
        svc = await ArbFactory.deploy();
      } catch (e) {
        console.error('DEPLOY ERROR stack:', e && e.stack);
        try { console.error('ArbFactory.interface.deploy.inputs.length:', ArbFactory.interface && ArbFactory.interface.deploy ? ArbFactory.interface.deploy.inputs.length : '(no)'); } catch (ee) {}
        try { console.error('ArbFactory.bytecode length:', (ArbFactory.bytecode || '').length); } catch (ee) {}
        throw e;
      }
    await svc.waitForDeployment();
  Rent = await ethers.getContractFactory('TemplateRentContract');
  // deploy rent with landlord and tenant and a simple mock price feed (reuse AggregatorV3Interface artifact deployed in tests env)
  // Use priceFeed = address(0) for tests where getRentInEth isn't required (feeBps==0)
  // Deploy without arbitration configured for the default 'service not configured' test
  rent = await Rent.deploy(landlord.address, tenant.address, 1 /* rentAmount */, 0 /* dueDate */, ethers.ZeroAddress, 0, ethers.ZeroAddress, 0, ethers.ZeroHash);
  await rent.waitForDeployment();
  });

  it('reverts if service not configured on target', async function () {
    // deploy a fresh rent with no arbitration configured
    const Rent = await ethers.getContractFactory('TemplateRentContract');
  const rentNoSvc = await Rent.deploy(landlord.address, tenant.address, 1, 0, ethers.ZeroAddress, 0, ethers.ZeroAddress, 0, ethers.ZeroHash);
    await rentNoSvc.waitForDeployment();
    // ensure cancelRequested is true
    await rentNoSvc.connect(tenant).initiateCancellation();
    await expect(svc.connect(landlord).finalizeByLandlord(rentNoSvc.target, { value: 0 })).to.be.revertedWith('service not configured on target');
  });

    it('allows landlord to finalize via service when configured', async function () {
    // deploy a new rent configured with the arbitration service in constructor
    const Rent = await ethers.getContractFactory('TemplateRentContract');
  const rentWithSvc = await Rent.deploy(landlord.address, tenant.address, 1, 0, ethers.ZeroAddress, 0, svc.target, 0, ethers.ZeroHash);
    await rentWithSvc.waitForDeployment();
    // tenant initiates cancellation (unilateral pending state)
    await rentWithSvc.connect(tenant).initiateCancellation();

    // Call finalizeByLandlord via service as landlord
    await svc.connect(landlord).finalizeByLandlord(rentWithSvc.target, { value: 0 });

  // Contract should be inactive
  const active = await rentWithSvc.active();
    expect(active).to.equal(false);
  });

  it('reverts if caller is not landlord', async function () {
    // deploy a new rent configured with the arbitration service in constructor
    const Rent = await ethers.getContractFactory('TemplateRentContract');
  const rentWithSvc = await Rent.deploy(landlord.address, tenant.address, 1, 0, ethers.ZeroAddress, 0, svc.target, 0, ethers.ZeroHash);
    await rentWithSvc.waitForDeployment();
    await rentWithSvc.connect(tenant).initiateCancellation();
    // other (not landlord) tries to call finalizeByLandlord
    await expect(svc.connect(other).finalizeByLandlord(rentWithSvc.target, { value: 0 })).to.be.revertedWith('Only landlord');
  });
});
