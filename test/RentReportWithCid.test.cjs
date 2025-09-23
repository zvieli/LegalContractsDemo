const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('TemplateRentContract - CID reporting', function () {
    it('stores bytes32 digest when reporting with CID (legacy helper)', async function () {
        const Rent = await ethers.getContractFactory('TemplateRentContract');
        // deploy with placeholder args: landlord, tenant, rentAmount, dueDate, priceFeed, propertyId, arb svc, requiredDeposit
        const [deployer, other] = await ethers.getSigners();
        const rent = await Rent.deploy(deployer.address, other.address, 1, 0, ethers.ZeroAddress, 0, ethers.ZeroAddress, 0);
        await rent.waitForDeployment();

    const cid = 'QmFakeCid123';
    const digest = ethers.keccak256(ethers.toUtf8Bytes(cid));

    // call new digest-only reportDispute API
    // Use DisputeType = 1 (ConditionStart) which allows requestedAmount == 0 for this test
    await rent.reportDispute(1, 0, digest);
    expect(await rent.getDisputeDigest(0)).to.equal(digest);
    });
});
