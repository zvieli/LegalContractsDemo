import pkg from "hardhat";
const { ethers } = pkg;
import { expect } from "chai";

describe("NDATemplate V7 Tests", function () {
  let arbitrationService;
  let arbitrationContractV2;
  let factory;
  let partyA, partyB, admin;

  beforeEach(async function () {
    [admin, partyA, partyB] = await ethers.getSigners();

    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    arbitrationService = await ArbitrationService.deploy();
    await arbitrationService.waitForDeployment();

    // Deploy ArbitrationContractV2 with service address
    const ArbitrationContractV2 = await ethers.getContractFactory('ArbitrationContractV2');
    arbitrationContractV2 = await ArbitrationContractV2.deploy(await arbitrationService.getAddress());
    await arbitrationContractV2.waitForDeployment();

    // Set admin as oracle for testing
    await arbitrationContractV2.connect(admin).setOracle(await admin.getAddress());

    // Set the ArbitrationContractV2 as the factory in ArbitrationService
    await arbitrationService.connect(admin).setFactory(await arbitrationContractV2.getAddress());

    const ContractFactory = await ethers.getContractFactory('ContractFactory');
    factory = await ContractFactory.deploy(); // No parameters required
    await factory.waitForDeployment();
  });

  it("should deploy V7 components", async function () {
    expect(await arbitrationService.getAddress()).to.not.equal(ethers.ZeroAddress);
    expect(await arbitrationContractV2.getAddress()).to.not.equal(ethers.ZeroAddress);
    expect(await factory.getAddress()).to.not.equal(ethers.ZeroAddress);
  });

  it("should test V7 arbitration request with ArbitrationContractV2", async function () {
    const mockContractAddress = await partyA.getAddress();
    const caseId = 1;
    const metadata = ethers.toUtf8Bytes("Dispute evidence");
    
    // Test arbitration request via ArbitrationContractV2
    await expect(
      arbitrationContractV2.connect(partyA).requestArbitration(
        mockContractAddress,
        caseId,
        metadata
      )
    ).to.emit(arbitrationContractV2, "ArbitrationRequested");
  });

  it("should validate Oracle workflow simulation with ArbitrationContractV2", async function () {
    const mockContractAddress = await partyA.getAddress();
    const caseId = 1;
    const metadata = ethers.toUtf8Bytes("Test evidence");

    // Submit arbitration request
    const tx = await arbitrationContractV2.connect(partyA).requestArbitration(
      mockContractAddress,
      caseId,
      metadata
    );

    const receipt = await tx.wait();
    
    // Find arbitration request event
    const event = receipt.logs.find(log => {
      try {
        const parsed = arbitrationContractV2.interface.parseLog(log);
        return parsed.name === 'ArbitrationRequested';
      } catch {
        return false;
      }
    });

    expect(event).to.not.be.undefined;
    
    const parsedEvent = arbitrationContractV2.interface.parseLog(event);
    const requestId = parsedEvent.args.requestId;

    // Simulate Chainlink Functions response with correct format
    const responseData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bool", "uint256", "address", "string", "string"],
      [true, ethers.parseEther("0.05"), await partyB.getAddress(), "AI Decision", "Reasoning text"]
    );

    // Simulate fulfillArbitration call (normally done by Chainlink oracle)
    await expect(
      arbitrationContractV2.connect(admin).fulfillArbitration(
        responseData,
        ethers.toUtf8Bytes(""), // no error
        mockContractAddress,
        caseId
      )
    ).to.emit(arbitrationContractV2, "ArbitrationFulfilled");
  });
});
