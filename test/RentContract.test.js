// test/RentContract.test.js - הגרסה המתוקנת
import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

// EIP712 sign helper (mirrors contract typehash)
async function signRent(signer, contract, landlord, tenant, rentAmount, dueDate) {
  const domain = {
    name: 'TemplateRentContract',
    version: '1',
    chainId: (await signer.provider.getNetwork()).chainId,
    verifyingContract: contract.target
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
    contractAddress: contract.target,
    landlord,
    tenant,
    rentAmount,
    dueDate
  };
  return await signer.signTypedData(domain, types, value);
}

describe("TemplateRentContract", function () {
  let RentContract, rentContract;
  let landlord, tenant, other;
  let mockPriceFeed;
  let token;
  let arbitrationService;

beforeEach(async function () {
  [landlord, tenant, other] = await ethers.getSigners();
  // העברת יותר ETH ל-tenant כדי לכסות גם gas costs
  await landlord.sendTransaction({
    to: tenant.address,
    value: ethers.parseEther("100.0") // יותר ETH
  });

  // Use real Chainlink ETH/USD aggregator address (Mainnet)
  // On Hardhat fork, this will work for price queries
  const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";

  // Deploy via factory (enforce factory-only policy)
  const Factory = await ethers.getContractFactory("ContractFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  // set factory default arbitration so created templates receive it immutably
  const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
  const arbsvc = await ArbitrationService.deploy();
  await arbsvc.waitForDeployment();
  await factory.setDefaultArbitrationService(arbsvc.target, 0);
  const tx = await factory.connect(landlord).createRentContract(
    tenant.address,
    ethers.parseEther("0.5"),
    CHAINLINK_ETH_USD,
    0
  );
  const receipt = await tx.wait();
  const evt = receipt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
  const deployedAddr = evt.args.contractAddress;
  rentContract = await ethers.getContractAt('TemplateRentContract', deployedAddr);

  // The factory already set the default arbitration service; reuse the deployed service reference
  arbitrationService = arbsvc;
});

  // Helper function for anyValue
  const anyValue = () => true;

  describe("Basic Functionality", function () {
    it("should deploy with correct initial values", async function () {
      expect(await rentContract.landlord()).to.equal(landlord.address);
      expect(await rentContract.tenant()).to.equal(tenant.address);
      expect(await rentContract.rentAmount()).to.equal(ethers.parseEther("0.5"));
      expect(await rentContract.active()).to.be.true;
    });
  });

  describe("Rent Payment", function () {
    it("should allow tenant to pay rent after both signatures", async function () {
      const rentAmount = ethers.parseEther("0.5");
      // sign landlord
      const sigLandlord = await signRent(landlord, rentContract, landlord.address, tenant.address, rentAmount, await rentContract.dueDate());
      await rentContract.connect(landlord).signRent(sigLandlord);
      // sign tenant
      const sigTenant = await signRent(tenant, rentContract, landlord.address, tenant.address, rentAmount, await rentContract.dueDate());
      await rentContract.connect(tenant).signRent(sigTenant);
      await expect(rentContract.connect(tenant).payRent(rentAmount))
        .to.emit(rentContract, "RentPaid")
        .withArgs(tenant.address, rentAmount, false);
      expect(await rentContract.rentPaid()).to.be.true;
      expect(await rentContract.totalPaid()).to.equal(rentAmount);
    });

    it("blocks payment until both parties sign (merged from RentSigningRestriction.test)", async function () {
      const rentAmount = await rentContract.rentAmount();
      // 1. attempt before any signatures
      await expect(rentContract.connect(tenant).payRent(rentAmount)).to.be.revertedWithCustomError(rentContract,'NotFullySigned');
      // 2. landlord signs
      const due = await rentContract.dueDate();
      const sigL = await signRent(landlord, rentContract, landlord.address, tenant.address, rentAmount, due);
      await expect(rentContract.connect(landlord).signRent(sigL)).to.emit(rentContract,'RentSigned');
      // still blocked
      await expect(rentContract.connect(tenant).payRent(rentAmount)).to.be.revertedWithCustomError(rentContract,'NotFullySigned');
      // 3. tenant signs
      const sigT = await signRent(tenant, rentContract, landlord.address, tenant.address, rentAmount, due);
      await expect(rentContract.connect(tenant).signRent(sigT)).to.emit(rentContract,'RentSigned');
      // 4. payment succeeds
      await expect(rentContract.connect(tenant).payRent(rentAmount)).to.emit(rentContract,'RentPaid');
    });
  });

describe("ETH Payment", function () {
  it("should allow tenant to pay rent in ETH after signatures", async function () {
    const rentInEth = await rentContract.getRentInEth();
    console.log("Rent in ETH:", ethers.formatEther(rentInEth));
    
    // בדיקה שהסכום סביר (אמור להיות around 0.00025 ETH for $0.5 rent at $2000/ETH)
    expect(parseFloat(ethers.formatEther(rentInEth))).to.be.lessThan(0.001);
    
    const tenantBalance = await ethers.provider.getBalance(tenant.address);
    expect(tenantBalance).to.be.greaterThan(rentInEth);

  const sigL = await signRent(landlord, rentContract, landlord.address, tenant.address, await rentContract.rentAmount(), await rentContract.dueDate());
  await rentContract.connect(landlord).signRent(sigL);
  const sigT = await signRent(tenant, rentContract, landlord.address, tenant.address, await rentContract.rentAmount(), await rentContract.dueDate());
  await rentContract.connect(tenant).signRent(sigT);
  await expect(rentContract.connect(tenant).payRentInEth({ value: rentInEth }))
    .to.emit(rentContract, "RentPaid")
    .withArgs(tenant.address, rentInEth, false);

    expect(await rentContract.rentPaid()).to.be.true;
  });

  it("should calculate plausible ETH amount relative to Chainlink price", async function () {
    const rentUsd = await rentContract.rentAmount(); // 0.5 * 1e18 (treating 18 decimals USD)
    const ethAmount = await rentContract.getRentInEth();
    // Sanity: result should be > 0 and far below 0.01 ETH for small USD rent
    expect(ethAmount).to.be.gt(0n);
    // upper bound conservative (if ETH price crashed to $100 we still are < 0.005 ETH)
    expect(ethAmount).to.be.lt(ethers.parseEther('0.01'));
  });
});

  // Token payment tests removed: ERC20 support has been removed from the project

  describe("Rent Signing", function () {
    it("should allow both parties to sign via EIP712", async function () {
      const rentAmt = await rentContract.rentAmount();
      const due = await rentContract.dueDate();
      const sigL = await signRent(landlord, rentContract, landlord.address, tenant.address, rentAmt, due);
      await expect(rentContract.connect(landlord).signRent(sigL)).to.emit(rentContract, 'RentSigned');
      const sigT = await signRent(tenant, rentContract, landlord.address, tenant.address, rentAmt, due);
      await expect(rentContract.connect(tenant).signRent(sigT)).to.emit(rentContract, 'RentSigned');
      expect(await rentContract.rentSigned()).to.be.true;
    });

    it("should revert with custom error on signature mismatch", async function () {
      // Other signs (not tenant) -> mismatch
      const rentAmt = await rentContract.rentAmount();
      const due = await rentContract.dueDate();
      const sigOther = await signRent(other, rentContract, landlord.address, tenant.address, rentAmt, due);
      await expect(rentContract.connect(tenant).signRent(sigOther)).to.be.revertedWithCustomError(rentContract, 'SignatureMismatch');
    });
  });

  // Additional EIP712 signature behavior tests merged from former RentSignature.test.js
  describe("EIP712 Additional Signature Behaviors", function () {
    it("locks dueDate after both parties sign (cannot modify)", async function () {
      // Deploy a fresh instance (independent scenario)
      const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
      const Factory = await ethers.getContractFactory('ContractFactory');
      const f = await Factory.deploy();
      await f.waitForDeployment();
      const tx2 = await f.createRentContract(tenant.address, await rentContract.rentAmount(), CHAINLINK_ETH_USD, 0);
      const rcpt2 = await tx2.wait();
      const log2 = rcpt2.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
      const fresh = await ethers.getContractAt('TemplateRentContract', log2.args.contractAddress);
      const dueDate = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      await fresh.connect(landlord).setDueDate(dueDate);
      const rentAmt = await fresh.rentAmount();
      const sigL = await signRent(landlord, fresh, landlord.address, tenant.address, rentAmt, dueDate);
      await expect(fresh.connect(landlord).signRent(sigL)).to.emit(fresh,'RentSigned');
      const sigT = await signRent(tenant, fresh, landlord.address, tenant.address, rentAmt, dueDate);
      await expect(fresh.connect(tenant).signRent(sigT)).to.emit(fresh,'RentSigned');
      await expect(fresh.connect(landlord).setDueDate(dueDate + 100)).to.be.revertedWithCustomError(fresh,'FullySignedDueDateLocked');
    });

    it("rejects reusing the same signature (AlreadySigned) and non-party (NotParty)", async function () {
      const CHAINLINK_ETH_USD = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
      const Factory = await ethers.getContractFactory('ContractFactory');
      const f = await Factory.deploy();
      await f.waitForDeployment();
      const tx3 = await f.createRentContract(tenant.address, await rentContract.rentAmount(), CHAINLINK_ETH_USD, 0);
      const rcpt3 = await tx3.wait();
      const log3 = rcpt3.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
      const fresh = await ethers.getContractAt('TemplateRentContract', log3.args.contractAddress);
      const dueDate = (await ethers.provider.getBlock('latest')).timestamp + 7200;
      await fresh.connect(landlord).setDueDate(dueDate);
      const rentAmt = await fresh.rentAmount();
      const sigL = await signRent(landlord, fresh, landlord.address, tenant.address, rentAmt, dueDate);
      await fresh.connect(landlord).signRent(sigL);
      await expect(fresh.connect(landlord).signRent(sigL)).to.be.revertedWithCustomError(fresh,'AlreadySigned');
      const fakeSig = await signRent(other, fresh, landlord.address, tenant.address, rentAmt, dueDate);
      await expect(fresh.connect(other).signRent(fakeSig)).to.be.revertedWithCustomError(fresh,'NotParty');
    });
  });

  describe("Admin Functions", function () {
    it("should allow landlord to update late fee", async function () {
      const newFee = 10; // 10%
      
      await expect(rentContract.connect(landlord).updateLateFee(newFee))
        .to.emit(rentContract, "LateFeeUpdated")
        .withArgs(newFee);

      expect(await rentContract.lateFeePercent()).to.equal(newFee);
    });
  });

  describe("Contract Cancellation", function () {
    it("should allow landlord to cancel contract", async function () {
      // landlord initiates cancellation
      await expect(rentContract.connect(landlord).initiateCancellation())
        .to.emit(rentContract, "CancellationInitiated");

      // finalize via arbitration service (owner of service is test deployer)
      await expect(arbitrationService.finalizeTargetCancellation(rentContract.target))
        .to.emit(rentContract, "ContractCancelled")
        .withArgs(landlord.address);

      expect(await rentContract.active()).to.be.false;
    });

    it("should allow tenant to cancel contract", async function () {
      await expect(rentContract.connect(tenant).initiateCancellation())
        .to.emit(rentContract, "CancellationInitiated");

      await expect(arbitrationService.finalizeTargetCancellation(rentContract.target))
        .to.emit(rentContract, "ContractCancelled")
        .withArgs(tenant.address);

      expect(await rentContract.active()).to.be.false;
    });

    it("should prevent payments after cancellation", async function () {
  await rentContract.connect(landlord).initiateCancellation();
      await arbitrationService.finalizeTargetCancellation(rentContract.target);

      await expect(rentContract.connect(tenant).payRent(ethers.parseEther("0.5")))
        .to.be.revertedWithCustomError(rentContract, 'NotActive');
    });
  });

  describe("Detailed Cancellation Policy", function () {
    it("only landlord can set cancellation policy and emits event", async function () {
      await expect(rentContract.connect(tenant).setCancellationPolicy(3600, 500, true))
        .to.be.revertedWithCustomError(rentContract, 'OnlyLandlord');

      await expect(rentContract.connect(landlord).setCancellationPolicy(3600, 500, true))
        .to.emit(rentContract, "CancellationPolicyUpdated")
        .withArgs(3600, 500, true);

      expect(await rentContract.noticePeriod()).to.equal(3600);
      expect(await rentContract.earlyTerminationFeeBps()).to.equal(500);
      expect(await rentContract.requireMutualCancel()).to.equal(true);
    });

    it("mutual cancellation: initiate + approve finalizes and deactivates", async function () {
      await rentContract.connect(landlord).setCancellationPolicy(0, 0, true);

      // Using cancelContract should act as initiate with policy set
      await expect(rentContract.connect(landlord).initiateCancellation())
        .to.emit(rentContract, "CancellationInitiated");

      expect(await rentContract.cancelRequested()).to.equal(true);
      expect(await rentContract.active()).to.equal(true);

      // Opposite party approves -> finalize
      await expect(rentContract.connect(tenant).approveCancellation())
        .to.emit(rentContract, "CancellationApproved");

      // finalize via arbitration service
      await expect(arbitrationService.finalizeTargetCancellation(rentContract.target))
        .to.emit(rentContract, "ContractCancelled")
        .and.to.emit(rentContract, "CancellationFinalized");

      expect(await rentContract.active()).to.equal(false);
    });

    it("unilateral with notice + fee: cannot finalize early; must pay fee to counterparty", async function () {
      // Set 1 hour notice and 10% early termination fee
      await rentContract.connect(landlord).setCancellationPolicy(3600, 1000, false);

      // Tenant initiates
      await expect(rentContract.connect(tenant).initiateCancellation())
        .to.emit(rentContract, "CancellationInitiated");

      // Try to finalize before notice elapsed -> revert
      // direct finalize call should now be disallowed (arbitration-only)
      await expect(rentContract.connect(tenant).finalizeCancellation())
        .to.be.revertedWithCustomError(rentContract, 'OnlyArbitrator');

      // Move time forward 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      // Calculate expected fee in ETH
      const rentInEth = await rentContract.getRentInEth();
      const expectedFee = (rentInEth * 1000n) / 10000n; // 10%

      // attempt to finalize via arbitration service before notice elapsed: service should be allowed to finalize
      // but this test asserts that tenant cannot finalize directly. Now call arbitration service after notice elapsed.
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      // Insufficient fee forwarded should revert
      if (expectedFee > 0n) {
        await expect(arbitrationService.finalizeTargetCancellation(rentContract.target, { value: expectedFee - 1n }))
          .to.be.reverted;
      }

      await expect(arbitrationService.finalizeTargetCancellation(rentContract.target, { value: expectedFee }))
        .to.emit(rentContract, "EarlyTerminationFeePaid")
        .withArgs(arbitrationService.target, expectedFee, landlord.address)
        .and.to.emit(rentContract, "ContractCancelled")
        .and.to.emit(rentContract, "CancellationFinalized");

      expect(await rentContract.active()).to.equal(false);
    });
  });

  // Guard scenarios merged from former CancellationScenarios.test.js (explicit address logic not needed)
  describe("Cancellation Guards", function () {
    it("prevent approve / finalize when no cancellation requested", async function () {
      await expect(rentContract.connect(tenant).approveCancellation()).to.be.revertedWithCustomError(rentContract,'CancelNotRequested');
  // finalize must be called via arbitration service — direct party call should revert OnlyArbitrator
  await expect(rentContract.connect(tenant).finalizeCancellation()).to.be.revertedWithCustomError(rentContract,'OnlyArbitrator');
    });

    it("approve after mutual policy initiation finalizes and blocks further approve", async function () {
      await rentContract.connect(landlord).setCancellationPolicy(0,0,true);
      await rentContract.connect(landlord).initiateCancellation();
      await expect(rentContract.connect(tenant).approveCancellation()).to.emit(rentContract,'CancellationApproved');
      // finalize via arbitration service
      await arbitrationService.finalizeTargetCancellation(rentContract.target);
      expect(await rentContract.active()).to.equal(false);
      await expect(rentContract.connect(tenant).approveCancellation()).to.be.revertedWithCustomError(rentContract,'NotActive');
    });
  });
});