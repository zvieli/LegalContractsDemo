import Hardhat from 'hardhat';
import { expect } from 'chai';

const { ethers } = Hardhat;

describe('Reporter bond forwarding semantics', function () {
  it('forwards forfeited bond to arbitration owner EOA', async function () {
    const [deployer, reporter, arbOwner] = await ethers.getSigners();

    // deploy ArbitrationService and set owner
    const ArbSvc = await ethers.getContractFactory('ArbitrationService');
    const arb = await ArbSvc.connect(arbOwner).deploy();
    await arb.waitForDeployment();

    // deploy TemplateRentContract with arb service
    const Rent = await ethers.getContractFactory('TemplateRentContract');
    const rent = await Rent.deploy(deployer.address, reporter.address, 1000, ethers.ZeroAddress, 0, arb.target, 0);
    await rent.waitForDeployment();

  // reporter files a dispute and sends a bond (use non-zero requestedAmount for Damage type)
  const tx = await rent.connect(reporter).reportDispute(0, 1, ethers.ZeroHash, { value: ethers.parseEther('0.01') });
    const rcpt = await tx.wait();
  // resolve as rejected via arb service: call resolveDisputeFinal with approve=false
  const beforeBal = await ethers.provider.getBalance(arbOwner.address);
  await arb.connect(arbOwner).applyResolutionToTarget(rent.target, 0, false, 0, reporter.address, { value: 0 });

  // After resolution, arbOwner should receive the bond (direct transfer) OR it should be credited via withdrawable
  const afterBal = await ethers.provider.getBalance(arbOwner.address);
  const w = await rent.withdrawable(arbOwner.address);
  const bal = BigInt(w || 0n);
  const delta = BigInt(afterBal) - BigInt(beforeBal);
  expect((delta > 0n) || (bal > 0n)).to.equal(true);
  });

  it('falls back to withdrawable when recipient rejects', async function () {
    const [deployer, reporter, arbOwner] = await ethers.getSigners();

    // deploy ArbitrationService and set owner
    const ArbSvc = await ethers.getContractFactory('ArbitrationService');
    const arb = await ArbSvc.connect(arbOwner).deploy();
    await arb.waitForDeployment();

    // deploy TemplateRentContract
    const Rent = await ethers.getContractFactory('TemplateRentContract');
    const rent = await Rent.deploy(deployer.address, reporter.address, 1000, ethers.ZeroAddress, 0, arb.target, 0);
    await rent.waitForDeployment();

    // deploy a RejectingReceiver contract that reverts on receive
    const Reject = await ethers.getContractFactory('RejectingReceiver');
    const rej = await Reject.deploy();
    await rej.waitForDeployment();

    // Force the ArbitrationService to have owner as the RejectingReceiver by transferring ownership
    await arb.connect(arbOwner).transferOwnership(rej.target);

  // reporter files a dispute and sends a bond (use non-zero requestedAmount)
  await rent.connect(reporter).reportDispute(0, 1, ethers.ZeroHash, { value: ethers.parseEther('0.02') });

  // resolve as rejected via arb service: call from the RejectingReceiver contract (now owner)
  // Use the helper on RejectingReceiver so the msg.sender to ArbitrationService is the RejectingReceiver
  await rej.callApplyResolution(arb.target, rent.target, 0, false, 0, reporter.address, { value: 0 });

    // Arb owner rejected the payment — bond should be recorded to withdrawable
    const w = await rent.withdrawable(rej.target);
    expect(BigInt(w || 0n) > 0n).to.equal(true);
  });
});
