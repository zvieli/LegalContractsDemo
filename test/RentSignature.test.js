import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;

// Helper to sign structured data (ethers v6 style) for TemplateRentContract
async function signRent(signer, contract, landlord, tenant, rentAmount, dueDate) {
  const domain = {
    name: 'TemplateRentContract',
    version: '1',
    chainId: (await signer.provider.getNetwork()).chainId,
    verifyingContract: await contract.getAddress()
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
    contractAddress: await contract.getAddress(),
    landlord,
    tenant,
    rentAmount,
    dueDate
  };
  return await signer.signTypedData(domain, types, value);
}

describe('TemplateRentContract EIP712 Signatures', function() {
  let landlord, tenant, other, priceFeed;

  beforeEach(async () => {
    [landlord, tenant, other] = await ethers.getSigners();
    // Deploy mock price feed (AggregatorV3Interface minimal)
  const Feed = await ethers.getContractFactory('MockPriceFeed');
  priceFeed = await Feed.deploy(2000); // $2000 baseline
    await priceFeed.waitForDeployment();
    // Deploy factory to create rent contract (reuse existing factory if in repo)
  });

  it('should sign by landlord and tenant and lock dueDate', async () => {
  // Deploy rent contract directly
  const rentAmount = ethers.parseEther('1');
  const Rent = await ethers.getContractFactory('TemplateRentContract');
  const rent = await Rent.deploy(landlord.address, tenant.address, rentAmount, await priceFeed.getAddress());
  await rent.waitForDeployment();

    // Set due date by landlord
    const dueDate = (await ethers.provider.getBlock('latest')).timestamp + 3600;
    await rent.connect(landlord).setDueDate(dueDate);

    const landlordSig = await signRent(landlord, rent, landlord.address, tenant.address, rentAmount, dueDate);
  await expect(rent.connect(landlord).signRent(landlordSig)).to.emit(rent, 'RentSigned');

    // Tenant signs
    const tenantSig = await signRent(tenant, rent, landlord.address, tenant.address, rentAmount, dueDate);
    await expect(rent.connect(tenant).signRent(tenantSig)).to.emit(rent, 'RentSigned');

    // After both signed, modifying dueDate should revert
    await expect(rent.connect(landlord).setDueDate(dueDate + 100)).to.be.revertedWith('Fully signed - dueDate locked');
  });

  it('should reject reused signature and non-party', async () => {
  const rentAmount = ethers.parseEther('0.5');
  const Rent = await ethers.getContractFactory('TemplateRentContract');
  const rent = await Rent.deploy(landlord.address, tenant.address, rentAmount, await priceFeed.getAddress());
  await rent.waitForDeployment();

    const dueDate = (await ethers.provider.getBlock('latest')).timestamp + 7200;
    await rent.connect(landlord).setDueDate(dueDate);

    const sig = await signRent(landlord, rent, landlord.address, tenant.address, rentAmount, dueDate);
    await rent.connect(landlord).signRent(sig);
    await expect(rent.connect(landlord).signRent(sig)).to.be.reverted; // already signed

    // Non-party attempt
    const fakeSig = await signRent(other, rent, landlord.address, tenant.address, rentAmount, dueDate);
    await expect(rent.connect(other).signRent(fakeSig)).to.be.revertedWith('Only parties');
  });
});
