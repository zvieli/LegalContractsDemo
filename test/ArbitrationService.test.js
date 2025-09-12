import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

describe('ArbitrationService ABI fallback', function () {
  let ArbitrationService, svc;
  let owner, other;

  // MockA: exposes `serviceResolve(uint256,bool,uint256,address)` which should succeed
  let MockA, mockA;
  // MockB: exposes `resolveDisputeFinal(uint256,bool,uint256,address,string,string)` which should succeed
  let MockB, mockB;
  // MockC: incompatible contract (no relevant entrypoints) should revert
  let MockC, mockC;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    svc = await ArbitrationService.deploy();
    await svc.waitForDeployment();

    MockA = await ethers.getContractFactory('MockArbTargetA');
    mockA = await MockA.deploy();
    await mockA.waitForDeployment();

    MockB = await ethers.getContractFactory('MockArbTargetB');
    mockB = await MockB.deploy();
    await mockB.waitForDeployment();

    MockC = await ethers.getContractFactory('MockArbTargetC');
    mockC = await MockC.deploy();
    await mockC.waitForDeployment();
  });

  it('calls serviceResolve on compatible MockA', async function () {
    await svc.applyResolutionToTarget(mockA.target, 1, true, 0, owner.address);
    // If call didn't revert, success
    expect(true).to.equal(true);
  });

  it('calls resolveDisputeFinal on compatible MockB', async function () {
    await svc.applyResolutionToTarget(mockB.target, 2, true, 0, owner.address);
    expect(true).to.equal(true);
  });

  it('reverts on incompatible MockC', async function () {
    await expect(svc.applyResolutionToTarget(mockC.target, 3, false, 0, owner.address)).to.be.revertedWith('No compatible resolution entrypoint on target');
  });
});
