import { expect } from 'chai';
import hre from 'hardhat';
const { ethers } = hre;

describe('CCIP arbitration E2E', function () {
  it('applies decision to MockTarget via ArbitrationService', async function () {
    const [deployer, arbSenderCaller] = await ethers.getSigners();
    const deployerAddr = typeof deployer.address === 'string' && deployer.address !== '' ? deployer.address : await deployer.getAddress();

    async function getAddr(c) {
      if (!c) return null;
      if (typeof c.address === 'string' && c.address !== '') return c.address;
      if (typeof c.getAddress === 'function') return await c.getAddress();
      return null;
    }

    // Deploy mocks
    const MockCCIPRouter = await ethers.getContractFactory('MockCCIPRouter');
    let router;
    try {
      router = await MockCCIPRouter.deploy(1000);
      if (typeof router.waitForDeployment === 'function') {
        await router.waitForDeployment();
      } else if (typeof router.deployed === 'function') {
        await router.deployed();
      }
    } catch (err) {
      // fallback for artifacts with no-arg constructor
      router = await MockCCIPRouter.deploy();
      if (typeof router.waitForDeployment === 'function') {
        await router.waitForDeployment();
      } else if (typeof router.deployed === 'function') {
        await router.deployed();
      }
      await router.setFixedFee(1000);
    }

    const MockLink = await ethers.getContractFactory('MockLinkToken');
    const parseEther = typeof ethers.parseEther === 'function' ? ethers.parseEther : ethers.utils.parseEther;
    const formatBytes32String = typeof ethers.formatBytes32String === 'function' ? ethers.formatBytes32String : (ethers.utils && ethers.utils.formatBytes32String ? ethers.utils.formatBytes32String : null);
    const link = await MockLink.deploy(parseEther('100000'));
    if (typeof link.waitForDeployment === 'function') {
      await link.waitForDeployment();
    } else if (typeof link.deployed === 'function') {
      await link.deployed();
    }

    // Deploy ArbitrationService
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    const service = await ArbitrationService.deploy();
    if (typeof service.waitForDeployment === 'function') {
      await service.waitForDeployment();
    } else if (typeof service.deployed === 'function') {
      await service.deployed();
    }

    // Deploy CCIPReceiver
    const Receiver = await ethers.getContractFactory('CCIPArbitrationReceiver');
    const routerAddr = await getAddr(router);
    const linkAddr = await getAddr(link);
    const serviceAddr = await getAddr(service);

    let receiver;
    try {
      receiver = await Receiver.deploy(routerAddr, serviceAddr);
      if (typeof receiver.waitForDeployment === 'function') {
        await receiver.waitForDeployment();
      } else if (typeof receiver.deployed === 'function') {
        await receiver.deployed();
      }
    } catch (err) {
      throw err;
    }

    // Authorize router/sender on receiver and service
    await receiver.setSourceChainAuthorization(0, true);
    await receiver.setSenderAuthorization(deployerAddr, true);
    const receiverAddr = await getAddr(receiver);
    await service.authorizeCCIPReceiver(receiverAddr, true);

    // Deploy Sender
    const Sender = await ethers.getContractFactory('CCIPArbitrationSender');
    let sender;
    try {
      sender = await Sender.deploy(routerAddr, linkAddr, 0, receiverAddr);
      if (typeof sender.waitForDeployment === 'function') {
        await sender.waitForDeployment();
      } else if (typeof sender.deployed === 'function') {
        await sender.deployed();
      }
    } catch (err) {
      throw err;
    }
    const senderAddr = await getAddr(sender);
    await sender.setContractAuthorization(senderAddr, true);
    await receiver.setSenderAuthorization(senderAddr, true);

    // Deploy MockTarget
    const MockTarget = await ethers.getContractFactory('MockTarget');
    let target;
    try {
      target = await MockTarget.deploy();
      if (typeof target.waitForDeployment === 'function') {
        await target.waitForDeployment();
      } else if (typeof target.deployed === 'function') {
        await target.deployed();
      }
    } catch (err) {
      throw err;
    }

    // Simulate an arbitration request
    const disputeId = ethers.keccak256(ethers.toUtf8Bytes('d1'));
    const caseId = 42;

    const targetAddr = await getAddr(target);
    await sender.setContractAuthorization(deployerAddr, true);

    const tx = await sender.connect(deployer).sendArbitrationRequest(
      disputeId,
      targetAddr,
      caseId,
      '0x' + '00'.repeat(32),
      '',
      0,
      0,
      { value: await sender.getArbitrationFees(0) }
    );

    const receipt = await tx.wait();
    const events = await router.queryFilter(router.filters.CCIPSent());
    expect(events.length).to.be.greaterThan(0);
    const messageId = events[events.length - 1].args.messageId;

    // Now simulate a decision via router helper
    try {
      const sentEvents = await router.queryFilter(router.filters.CCIPSent());
      const originalSender = sentEvents[sentEvents.length - 1].args.sender;

      await router.simulateDecisionTo(
        receiverAddr,
        messageId,
        0,
        originalSender,
        disputeId,
        true,
        parseEther('0.1'),
        deployerAddr,
        'approved',
        '0x' + '00'.repeat(32),
        targetAddr,
        caseId
      );
    } catch (err) {
      throw err;
    }

    const decoded = await receiver.getDecision(messageId);

    const res = await target.getResolution(caseId);

    try {
      await service.connect(deployer).applyResolutionToTarget(targetAddr, caseId, true, parseEther('0.1'), deployerAddr);
      const evs = await target.queryFilter(target.filters.ServiceResolved());
      // direct apply ok
    } catch (err) {
      // ignore
    }

    try {
      await service.authorizeCCIPReceiver(deployerAddr, true);
      const decisionTuple = [
        decoded[0],
        decoded[1],
        decoded[2].toString(),
        decoded[3],
        decoded[4],
        decoded[5],
        decoded[6].toString(),
        decoded[7],
        decoded[8].toString()
      ];

      await service.connect(deployer).receiveCCIPDecision(messageId, targetAddr, caseId, decisionTuple);
    } catch (err) {
      // ignore
    }

    expect(res[0]).to.equal(caseId);
    expect(res[1]).to.equal(true);
    expect(res[2].toString()).to.equal(parseEther('0.1').toString());
    expect(res[3]).to.equal(deployerAddr);
  });
  });
