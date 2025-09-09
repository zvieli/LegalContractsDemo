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

beforeEach(async function () {
  [landlord, tenant, other] = await ethers.getSigners();
  
  // העברת יותר ETH ל-tenant כדי לכסות גם gas costs
  await landlord.sendTransaction({
    to: tenant.address,
    value: ethers.parseEther("100.0") // יותר ETH
  });
  
  // Deploy MockPriceFeed
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  mockPriceFeed = await MockPriceFeed.deploy(2000);
  await mockPriceFeed.waitForDeployment();

  // Deploy MockERC20
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  token = await MockERC20.deploy("TestToken", "TTK", ethers.parseUnits("1000", 18));
  await token.waitForDeployment();

  // Deploy via factory (enforce factory-only policy)
  const Factory = await ethers.getContractFactory("ContractFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const tx = await factory.connect(landlord).createRentContract(
          tenant.address,
          ethers.parseEther("0.5"),
          mockPriceFeed.target,
          0
  );
  const receipt = await tx.wait();
  const evt = receipt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
  const deployedAddr = evt.args.contractAddress;
  rentContract = await ethers.getContractAt('TemplateRentContract', deployedAddr);

  // Mint & Approve tokens for tenant
  await token.transfer(tenant.address, ethers.parseUnits("500", 18));
  await token.connect(tenant).approve(rentContract.target, ethers.parseUnits("500", 18));
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
        .withArgs(tenant.address, rentAmount, false, ethers.ZeroAddress);
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
      .withArgs(tenant.address, rentInEth, false, ethers.ZeroAddress);

    expect(await rentContract.rentPaid()).to.be.true;
  });

  it("should calculate correct ETH amount", async function () {
    // rentAmount = 0.5 USD
    // price = 2000 USD/ETH 
    // expected: 0.5 / 2000 = 0.00025 ETH
    const expectedEth = ethers.parseEther("0.5") / 2000n;
    const actualEth = await rentContract.getRentInEth();
    
    expect(actualEth).to.be.closeTo(expectedEth, expectedEth / 100n); // within 1%
  });
});

  describe("Token Payment", function () {
    it("should allow tenant to pay rent with ERC20 token after signatures", async function () {
      const initialLandlordBalance = await token.balanceOf(landlord.address);
      const rentAmount = ethers.parseUnits("100", 18);
      const sigL = await signRent(landlord, rentContract, landlord.address, tenant.address, await rentContract.rentAmount(), await rentContract.dueDate());
      await rentContract.connect(landlord).signRent(sigL);
      const sigT = await signRent(tenant, rentContract, landlord.address, tenant.address, await rentContract.rentAmount(), await rentContract.dueDate());
      await rentContract.connect(tenant).signRent(sigT);

      await expect(rentContract.connect(tenant).payRentWithToken(token.target, rentAmount))
        .to.emit(rentContract, "RentPaid")
        .withArgs(tenant.address, rentAmount, false, token.target);

      expect(await token.balanceOf(landlord.address)).to.equal(initialLandlordBalance + rentAmount);
      expect(await rentContract.tokenPaid(token.target)).to.equal(rentAmount);
    });

    it("should revert when tenant tries to pay with ERC20 without approve", async function () {
      // revoke approval
      await token.connect(tenant).approve(rentContract.target, 0);

      const rentAmount = ethers.parseUnits("100", 18);

      await expect(rentContract.connect(tenant).payRentWithToken(token.target, rentAmount))
        .to.be.reverted; // SafeERC20 will revert if transferFrom fails
    });
  });

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
  const Factory = await ethers.getContractFactory('ContractFactory');
  const f = await Factory.deploy();
  await f.waitForDeployment();
  const tx2 = await f.createRentContract(tenant.address, await rentContract.rentAmount(), mockPriceFeed.target, 0);
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
  const Factory = await ethers.getContractFactory('ContractFactory');
  const f = await Factory.deploy();
  await f.waitForDeployment();
  const tx3 = await f.createRentContract(tenant.address, await rentContract.rentAmount(), mockPriceFeed.target, 0);
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
      await expect(rentContract.connect(landlord).cancelContract())
        .to.emit(rentContract, "ContractCancelled")
        .withArgs(landlord.address);

      expect(await rentContract.active()).to.be.false;
    });

    it("should allow tenant to cancel contract", async function () {
      await expect(rentContract.connect(tenant).cancelContract())
        .to.emit(rentContract, "ContractCancelled")
        .withArgs(tenant.address);

      expect(await rentContract.active()).to.be.false;
    });

    it("should prevent payments after cancellation", async function () {
      await rentContract.connect(landlord).cancelContract();

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
      await expect(rentContract.connect(landlord).cancelContract())
        .to.emit(rentContract, "CancellationInitiated");

      expect(await rentContract.cancelRequested()).to.equal(true);
      expect(await rentContract.active()).to.equal(true);

      // Opposite party approves -> finalize
      await expect(rentContract.connect(tenant).approveCancellation())
        .to.emit(rentContract, "CancellationApproved")
        .and.to.emit(rentContract, "ContractCancelled")
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
      await expect(rentContract.connect(tenant).finalizeCancellation())
        .to.be.revertedWithCustomError(rentContract, 'NoticeNotElapsed');

      // Move time forward 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      // Calculate expected fee in ETH
      const rentInEth = await rentContract.getRentInEth();
      const expectedFee = (rentInEth * 1000n) / 10000n; // 10%

      // Insufficient fee should revert
      if (expectedFee > 0n) {
        await expect(rentContract.connect(tenant).finalizeCancellation({ value: expectedFee - 1n }))
          .to.be.revertedWithCustomError(rentContract, 'InsufficientFee');
      }

      // Track landlord balance change approximately by fee via event
      await expect(rentContract.connect(tenant).finalizeCancellation({ value: expectedFee }))
        .to.emit(rentContract, "EarlyTerminationFeePaid")
        .withArgs(tenant.address, expectedFee, landlord.address)
        .and.to.emit(rentContract, "ContractCancelled")
        .and.to.emit(rentContract, "CancellationFinalized");

      expect(await rentContract.active()).to.equal(false);
    });
  });

  // Guard scenarios merged from former CancellationScenarios.test.js (explicit address logic not needed)
  describe("Cancellation Guards", function () {
    it("prevent approve / finalize when no cancellation requested", async function () {
      await expect(rentContract.connect(tenant).approveCancellation()).to.be.revertedWithCustomError(rentContract,'CancelNotRequested');
      await expect(rentContract.connect(tenant).finalizeCancellation()).to.be.revertedWithCustomError(rentContract,'CancelNotRequested');
    });

    it("approve after mutual policy initiation finalizes and blocks further approve", async function () {
      await rentContract.connect(landlord).setCancellationPolicy(0,0,true);
      await rentContract.connect(landlord).initiateCancellation();
      await expect(rentContract.connect(tenant).approveCancellation()).to.emit(rentContract,'CancellationApproved');
      expect(await rentContract.active()).to.equal(false);
      await expect(rentContract.connect(tenant).approveCancellation()).to.be.revertedWithCustomError(rentContract,'NotActive');
    });
  });
});