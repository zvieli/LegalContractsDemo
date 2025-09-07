import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

/*
  This spec documents and enforces the new rule: rent payments are blocked until BOTH parties EIP712-sign.
  Flow:
   1. Deploy MockPriceFeed + TemplateRentContract via factory (or direct deploy of rent contract isn't exposed by factory, so we deploy contract directly here for simplicity).
   2. Attempt tenant payment before signatures -> expect revert NotFullySigned (custom error).
   3. Produce EIP712 signatures for landlord & tenant (dueDate = 0) and call signRent for each.
   4. After both signed, payment succeeds.
*/

describe('RentSigningRestriction', function () {
  let landlord, tenant, other;
  let rent;
  let mockPriceFeed;

  const RENT_AMOUNT = 100n; // arbitrary units as used by payRent(uint256)

  async function signFor(signer, contractAddr, landlordAddr, tenantAddr, rentAmount, dueDate) {
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: contractAddr
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
      contractAddress: contractAddr,
      landlord: landlordAddr,
      tenant: tenantAddr,
      rentAmount: rentAmount,
      dueDate: dueDate
    };
    return await signer.signTypedData(domain, types, value);
  }

  beforeEach(async () => {
    [landlord, tenant, other] = await ethers.getSigners();

    const MockPriceFeed = await ethers.getContractFactory('MockPriceFeed');
    mockPriceFeed = await MockPriceFeed.deploy(2000); // price placeholder
    await mockPriceFeed.waitForDeployment();

    // Direct deploy TemplateRentContract for tight control
    const Rent = await ethers.getContractFactory('TemplateRentContract');
    rent = await Rent.deploy(landlord.address, tenant.address, RENT_AMOUNT, mockPriceFeed.target);
    await rent.waitForDeployment();
  });

  it('blocks payment until fully signed and then allows it', async () => {
    // 1. Try pay before signatures
    await expect(
      rent.connect(tenant).payRent(RENT_AMOUNT)
    ).to.be.revertedWithCustomError(rent, 'NotFullySigned');

    // 2. Sign by landlord
    const sigLandlord = await signFor(
      landlord,
      await rent.getAddress(),
      landlord.address,
      tenant.address,
      RENT_AMOUNT,
      0n
    );
    await expect(rent.connect(landlord).signRent(sigLandlord))
      .to.emit(rent, 'RentSigned');

    // 3. Still blocked after only one signature
    await expect(
      rent.connect(tenant).payRent(RENT_AMOUNT)
    ).to.be.revertedWithCustomError(rent, 'NotFullySigned');

    // 4. Sign by tenant
    const sigTenant = await signFor(
      tenant,
      await rent.getAddress(),
      landlord.address,
      tenant.address,
      RENT_AMOUNT,
      0n
    );
    await expect(rent.connect(tenant).signRent(sigTenant))
      .to.emit(rent, 'RentSigned');

    // 5. Now payment should succeed
    await expect(
      rent.connect(tenant).payRent(RENT_AMOUNT)
    ).to.emit(rent, 'RentPaid');
  });
});
