import { expect } from 'chai';
import hre from 'hardhat';
const { ethers } = hre;

describe('CCIP forwarding unit tests', function () {
  it('forwards encoded decision and prevents replay', async function () {
    const [deployer] = await ethers.getSigners();
    const parseEther = typeof ethers.parseEther === 'function' ? ethers.parseEther : ethers.utils.parseEther;

    const MockCCIPRouter = await ethers.getContractFactory('MockCCIPRouter');
    const router = await MockCCIPRouter.deploy(1000);
    if (typeof router.waitForDeployment === 'function') await router.waitForDeployment(); else await router.deployed();

    const MockLink = await ethers.getContractFactory('MockLinkToken');
    const link = await MockLink.deploy(parseEther('100000'));
    if (typeof link.waitForDeployment === 'function') await link.waitForDeployment(); else await link.deployed();

    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    const service = await ArbitrationService.deploy();
    if (typeof service.waitForDeployment === 'function') await service.waitForDeployment(); else await service.deployed();

    async function getAddr(c) {
      if (!c) return null;
      if (typeof c.address === 'string' && c.address !== '') return c.address;
      if (typeof c.getAddress === 'function') return await c.getAddress();
      return null;
    }

    const Receiver = await ethers.getContractFactory('CCIPArbitrationReceiver');
    const routerAddr = await getAddr(router);
    const serviceAddr = await getAddr(service);
    const receiver = await Receiver.deploy(routerAddr, serviceAddr);
    if (typeof receiver.waitForDeployment === 'function') await receiver.waitForDeployment(); else await receiver.deployed();

    await receiver.setSourceChainAuthorization(0, true);
    const deployerAddr = typeof deployer.address === 'string' && deployer.address !== '' ? deployer.address : await deployer.getAddress();
    await receiver.setSenderAuthorization(deployerAddr, true);
    const receiverAddr = await getAddr(receiver);
    await service.authorizeCCIPReceiver(receiverAddr, true);

    const MockTarget = await ethers.getContractFactory('MockTarget');
    const target = await MockTarget.deploy();
    if (typeof target.waitForDeployment === 'function') await target.waitForDeployment(); else await target.deployed();

    const disputeId = ethers.keccak256(ethers.toUtf8Bytes('utest'));
    const messageId = ethers.keccak256(ethers.toUtf8Bytes('msg-1'));

    const targetAddr = await getAddr(target);
    await router.simulateDecisionTo(
      receiverAddr,
      messageId,
      0,
      deployerAddr,
      disputeId,
      true,
      parseEther('0.01'),
      deployerAddr,
      'ok',
      '0x' + '00'.repeat(32),
      targetAddr,
      7
    );

    const res = await target.getResolution(7);
    expect(res[0]).to.equal(7);
    expect(res[1]).to.equal(true);

    let err = null;
    try {
      await router.simulateDecisionTo(
        receiverAddr,
        messageId,
        0,
        deployerAddr,
        disputeId,
        true,
        parseEther('0.01'),
        deployerAddr,
        'ok',
        '0x' + '00'.repeat(32),
        targetAddr,
        7
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.not.equal(null);

    const res2 = await target.getResolution(7);
    expect(res2[0]).to.equal(7);
  });
});
