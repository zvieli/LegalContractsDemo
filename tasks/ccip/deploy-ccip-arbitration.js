/**
 * Deploy CCIP Arbitration Contracts
 * Deploys CCIPArbitrationSender and CCIPArbitrationReceiver contracts
 */

import { task } from "hardhat/config.js";

task("deploy-ccip-arbitration", "Deploy CCIP Arbitration contracts")
  .addOptionalParam("router", "CCIP Router address (uses local simulator if not provided)")
  .addOptionalParam("link", "LINK token address (uses local simulator if not provided)")
  .addOptionalParam("oracleChain", "Oracle chain selector", "16015286601757825753") // Example chain selector
  .addOptionalParam("arbitrationService", "ArbitrationService contract address")
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const [deployer] = await ethers.getSigners();

    console.log("\n🚀 Deploying CCIP Arbitration Contracts...");
    console.log("📝 Deployer:", deployer.address);
    console.log("💰 Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

    let router = taskArgs.router;
    let linkToken = taskArgs.link;
    let oracleChainSelector = taskArgs.oracleChain;

    // Check if we're on localhost/hardhat and should use simulator
    const networkName = hre.network.name;
    const isLocalNetwork = networkName === "localhost" || networkName === "hardhat";

    if (isLocalNetwork && (!router || !linkToken)) {
      console.log("🧪 Local network detected, deploying CCIP Local Simulator...");
      
      // Deploy CCIP Local Simulator for local testing
      const CCIPLocalSimulatorFactory = await ethers.getContractFactory("CCIPLocalSimulator");
      const ccipLocalSimulator = await CCIPLocalSimulatorFactory.deploy();
      await ccipLocalSimulator.waitForDeployment();

      const simulatorConfig = await ccipLocalSimulator.configuration();
      router = simulatorConfig.sourceRouter_;
      linkToken = simulatorConfig.linkToken_;
      oracleChainSelector = simulatorConfig.chainSelector_;

      console.log("✅ CCIP Local Simulator deployed:", await ccipLocalSimulator.getAddress());
      console.log("📡 Router:", router);
      console.log("🔗 LINK Token:", linkToken);
      console.log("🆔 Chain Selector:", oracleChainSelector);
    }

    // Get ArbitrationService address
    let arbitrationServiceAddress = taskArgs.arbitrationService;
    if (!arbitrationServiceAddress) {
      try {
        // Try to get from deployments
        const deployments = await import("../artifacts/deployments.json", { with: { type: "json" } });
        arbitrationServiceAddress = deployments.default?.ArbitrationService?.address;
      } catch (error) {
        console.log("⚠️ Could not find ArbitrationService deployment");
      }
    }

    if (!arbitrationServiceAddress) {
      console.log("🔄 Deploying ArbitrationService first...");
      const ArbitrationServiceFactory = await ethers.getContractFactory("ArbitrationService");
      const arbitrationService = await ArbitrationServiceFactory.deploy();
      await arbitrationService.waitForDeployment();
      arbitrationServiceAddress = await arbitrationService.getAddress();
      console.log("✅ ArbitrationService deployed:", arbitrationServiceAddress);
    }

    console.log("\n📋 Deployment Configuration:");
    console.log("📡 Router:", router);
    console.log("🔗 LINK Token:", linkToken);
    console.log("🆔 Oracle Chain Selector:", oracleChainSelector);
    console.log("⚖️ ArbitrationService:", arbitrationServiceAddress);

    // Deploy CCIPArbitrationReceiver first (oracle side)
    console.log("\n📥 Deploying CCIPArbitrationReceiver...");
    const CCIPArbitrationReceiverFactory = await ethers.getContractFactory("CCIPArbitrationReceiver");
    const ccipReceiver = await CCIPArbitrationReceiverFactory.deploy(
      router,
      arbitrationServiceAddress
    );
    await ccipReceiver.waitForDeployment();
    const receiverAddress = await ccipReceiver.getAddress();
    console.log("✅ CCIPArbitrationReceiver deployed:", receiverAddress);

    // Deploy CCIPArbitrationSender (contract side)
    console.log("\n📤 Deploying CCIPArbitrationSender...");
    const CCIPArbitrationSenderFactory = await ethers.getContractFactory("CCIPArbitrationSender");
    const ccipSender = await CCIPArbitrationSenderFactory.deploy(
      router,
      linkToken,
      oracleChainSelector,
      receiverAddress
    );
    await ccipSender.waitForDeployment();
    const senderAddress = await ccipSender.getAddress();
    console.log("✅ CCIPArbitrationSender deployed:", senderAddress);

    // Setup authorization on receiver
    console.log("\n🔐 Setting up authorizations...");
    
    // Authorize the source chain (for local testing, same chain)
    await ccipReceiver.setSourceChainAuthorization(oracleChainSelector, true);
    console.log("✅ Source chain authorized on receiver");

    // Authorize the sender contract
    await ccipReceiver.setSenderAuthorization(senderAddress, true);
    console.log("✅ Sender contract authorized on receiver");

    // Setup authorization on sender (authorize ArbitrationService or other contracts)
    if (arbitrationServiceAddress) {
      await ccipSender.setContractAuthorization(arbitrationServiceAddress, true);
      console.log("✅ ArbitrationService authorized on sender");
    }

    // Save deployment info
    const deployment = {
      network: networkName,
      chainId: (await ethers.provider.getNetwork()).chainId,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      contracts: {
        CCIPArbitrationSender: {
          address: senderAddress,
          router: router,
          linkToken: linkToken,
          oracleChainSelector: oracleChainSelector,
          oracleReceiver: receiverAddress
        },
        CCIPArbitrationReceiver: {
          address: receiverAddress,
          router: router,
          arbitrationService: arbitrationServiceAddress
        },
        ArbitrationService: {
          address: arbitrationServiceAddress
        }
      }
    };

    if (isLocalNetwork) {
      deployment.ccipLocalSimulator = await ccipLocalSimulator.getAddress();
    }

    // Save to file
    const fs = await import("fs");
    const path = await import("path");
    const deploymentPath = path.join(process.cwd(), "deployments", `ccip-${networkName}.json`);
    
    // Ensure deployments directory exists
    if (!fs.existsSync(path.dirname(deploymentPath))) {
      fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    }
    
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

    console.log("\n🎉 CCIP Arbitration Deployment Complete!");
    console.log("📁 Deployment saved to:", deploymentPath);
    console.log("\n📋 Contract Addresses:");
    console.log("📤 CCIPArbitrationSender:", senderAddress);
    console.log("📥 CCIPArbitrationReceiver:", receiverAddress);
    console.log("⚖️ ArbitrationService:", arbitrationServiceAddress);

    if (isLocalNetwork) {
      console.log("🧪 CCIP Local Simulator:", await ccipLocalSimulator.getAddress());
    }

    console.log("\n🔧 Next Steps:");
    console.log("1. Update your contract templates to use the sender address");
    console.log("2. Configure the CCIP event listener with the receiver address");
    console.log("3. Fund the sender contract with LINK or native tokens for fees");
    console.log("4. Test arbitration flow with test contracts");

    return {
      sender: senderAddress,
      receiver: receiverAddress,
      arbitrationService: arbitrationServiceAddress,
      deployment
    };
  });