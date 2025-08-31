import { run } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verify(contractAddress, args) {
  console.log(`🔍 Verifying contract at ${contractAddress}...`);
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: args,
    });
    console.log("✅ Contract verified successfully!");
  } catch (e) {
    if (e.message.toLowerCase().includes("already verified")) {
      console.log("✅ Contract already verified");
    } else {
      console.log("❌ Verification failed:", e.message);
    }
  }
}

async function main() {
  const network = hre.network.name;
  const deploymentFile = path.join(__dirname, `../deployments/deployment-${network}.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.log("❌ No deployment file found for network:", network);
    return;
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  
  console.log(`🌐 Verifying contracts on ${network}...`);
  
  await verify(deploymentData.contracts.ContractFactory, []);
  await verify(deploymentData.contracts.TemplateRentContract, []);
  await verify(deploymentData.contracts.NDATemplate, []);
  await verify(deploymentData.contracts.Arbitrator, []);
  
  console.log("🎉 All contracts verified!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  });