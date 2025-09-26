const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('TemplateRentContract - digest reporting', function () {
    it('stores bytes32 digest when reporting with a legacy payload (legacy helper)', async function () {
        const Rent = await ethers.getContractFactory('TemplateRentContract');
        // deploy with placeholder args: landlord, tenant, rentAmount, dueDate, priceFeed, propertyId, arb svc, requiredDeposit
        const [deployer, other] = await ethers.getSigners();
    const rent = await Rent.deploy(deployer.address, other.address, 1, 0, ethers.ZeroAddress, 0, ethers.ZeroAddress, 0, '0x' + '00'.repeat(32));
        await rent.waitForDeployment();

    // In legacy flows a CID string would be used. The contract accepts a
    // bytes32 digest of an off-chain payload. For this test we'll simulate
    // that by hashing a representative payload string.
    const payload = 'legacy-cid-payload-sim';
    const digest = ethers.keccak256(ethers.toUtf8Bytes(payload));

    // call digest-only reportDispute API
    // Use DisputeType = 1 (ConditionStart) which allows requestedAmount == 0 for this test
    await rent.reportDispute(1, 0, digest);
    expect(await rent.getDisputeDigest(0)).to.equal(digest);
    });
});
