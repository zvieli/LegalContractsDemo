import "dotenv/config";
import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const [owner] = await ethers.getSigners();
  const addrFromCli = process.env.ORACLE_FUNCTIONS_ADDR || process.argv[2];
  if (!addrFromCli) {
    throw new Error("Missing OracleArbitratorFunctions address. Set ORACLE_FUNCTIONS_ADDR or pass as first arg.");
  }

  const subId = process.env.CLF_SUBSCRIPTION_ID;
  const donIdHex = process.env.CLF_DON_ID; // e.g., 0x... from Chainlink docs
  const gasLimit = process.env.CLF_GAS_LIMIT ? Number(process.env.CLF_GAS_LIMIT) : 300000;

  if (!subId || !donIdHex) {
    throw new Error("Missing CLF_SUBSCRIPTION_ID or CLF_DON_ID env vars");
  }

  let source = process.env.CLF_SOURCE;
  if (!source) {
    const defaultSourcePath = path.join(__dirname, "../chainlink/functions/ai_oracle.js");
    if (fs.existsSync(defaultSourcePath)) {
      source = fs.readFileSync(defaultSourcePath, "utf8");
    } else {
      throw new Error("No CLF_SOURCE provided and default ai_oracle.js not found");
    }
  }

  const Oracle = await ethers.getContractFactory("OracleArbitratorFunctions");
  const oracle = Oracle.attach(addrFromCli).connect(owner);

  console.log(`Configuring OracleArbitratorFunctions at ${addrFromCli} on ${network.name}...`);
  const tx = await oracle.setFunctionsConfig(subId, donIdHex, gasLimit, source);
  await tx.wait();
  console.log("✅ Functions config set: ", { subId, donIdHex, gasLimit, sourceLength: source.length });
}

main().catch((err) => {
  console.error("❌ configure-functions failed:", err.message);
  process.exit(1);
});
