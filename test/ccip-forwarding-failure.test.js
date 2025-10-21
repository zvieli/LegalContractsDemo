import { expect } from 'chai';
import hre from 'hardhat';
const { ethers } = hre;

describe('CCIP forwarding failure behavior', function () {
  it('emits ArbitrationForwardFailed when service call fails and not when it succeeds', async function () {
    const [deployer] = await ethers.getSigners();
    const parseEther = typeof ethers.parseEther === 'function' ? ethers.parseEther : ethers.utils.parseEther;

    async function getAddr(c) {
      if (!c) return null;
      if (typeof c.address === 'string' && c.address !== '') return c.address;
      if (typeof c.getAddress === 'function') return await c.getAddress();
      return null;
    }

    const MockCCIPRouter = await ethers.getContractFactory('MockCCIPRouter');
    const router = await MockCCIPRouter.deploy(1000);
    if (typeof router.waitForDeployment === 'function') await router.waitForDeployment(); else await router.deployed();

    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    const goodService = await ArbitrationService.deploy();
    if (typeof goodService.waitForDeployment === 'function') await goodService.waitForDeployment(); else await goodService.deployed();

    const FailingServiceFactory = await ethers.getContractFactory('FailingService');
    const failingService = await FailingServiceFactory.deploy();
    if (typeof failingService.waitForDeployment === 'function') await failingService.waitForDeployment(); else await failingService.deployed();

    const Receiver = await ethers.getContractFactory('CCIPArbitrationReceiver');
    const routerAddr = await getAddr(router);
    const goodServiceAddr = await getAddr(goodService);
    const receiver = await Receiver.deploy(routerAddr, goodServiceAddr);
    if (typeof receiver.waitForDeployment === 'function') await receiver.waitForDeployment(); else await receiver.deployed();

    await receiver.setSourceChainAuthorization(0, true);
    const deployerAddr = typeof deployer.address === 'string' && deployer.address !== '' ? deployer.address : await deployer.getAddress();
    await receiver.setSenderAuthorization(deployerAddr, true);
    const receiverAddr = await getAddr(receiver);
    await goodService.authorizeCCIPReceiver(receiverAddr, true);

    const MockTarget = await ethers.getContractFactory('MockTarget');
    const target = await MockTarget.deploy();
    if (typeof target.waitForDeployment === 'function') await target.waitForDeployment(); else await target.deployed();

    await receiver.transferOwnership(deployerAddr);
    await goodService.authorizeCCIPReceiver(receiverAddr, true);

    const disputeId = ethers.keccak256(ethers.toUtf8Bytes('ok'));
    const messageIdOk = ethers.keccak256(ethers.toUtf8Bytes('ok-msg'));

    const targetAddr = await getAddr(target);
    await router.simulateDecisionTo(
      receiverAddr,
      messageIdOk,
      0,
      deployerAddr,
      disputeId,
      true,
      parseEther('0.01'),
      deployerAddr,
      'ok',
      '0x' + '00'.repeat(32),
      targetAddr,
      11
    );

    const forwardFailedEvents1 = await receiver.queryFilter(receiver.filters.ArbitrationForwardFailed());
    expect(forwardFailedEvents1.length).to.equal(0);

  const failingServiceAddr = await getAddr(failingService);
  const receiver2 = await Receiver.deploy(routerAddr, failingServiceAddr);
    if (typeof receiver2.waitForDeployment === 'function') await receiver2.waitForDeployment(); else await receiver2.deployed();
    await receiver2.setSourceChainAuthorization(0, true);
    await receiver2.setSenderAuthorization(deployerAddr, true);

    const messageIdBad = ethers.keccak256(ethers.toUtf8Bytes('bad-msg'));
    const disputeIdBad = ethers.keccak256(ethers.toUtf8Bytes('bad'));

    const receiver2Addr = await getAddr(receiver2);
    const targetAddr2 = await getAddr(target);
    await router.simulateDecisionTo(
      receiver2Addr,
      messageIdBad,
      0,
      deployerAddr,
      disputeIdBad,
      true,
      parseEther('0.01'),
      deployerAddr,
      'bad',
      '0x' + '00'.repeat(32),
      targetAddr2,
      12
    );

    const forwardFailedEvents2 = await receiver2.queryFilter(receiver2.filters.ArbitrationForwardFailed());
    expect(forwardFailedEvents2.length).to.be.greaterThan(0);
  });
});
