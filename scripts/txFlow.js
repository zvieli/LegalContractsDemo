import pkg from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFactoryAddress() {
  try {
    const p = path.join(__dirname, "../front/src/utils/contracts/ContractFactory.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const addr = j?.contracts?.ContractFactory;
    if (!addr) throw new Error("Missing ContractFactory address in frontend JSON");
    return addr;
  } catch (e) {
    throw new Error(`Could not read ContractFactory address: ${e.message}`);
  }
}

async function loadBlockTime(blockNumber) {
  const blk = await ethers.provider.getBlock(blockNumber);
  return blk?.timestamp ? new Date(Number(blk.timestamp) * 1000).toISOString() : "";
}

async function timelineForRent(addr) {
  const rent = await ethers.getContractAt("TemplateRentContract", addr);
  const tl = [];

  try {
    const events = await rent.queryFilter(rent.filters.RentPaid());
    for (const ev of events) {
      tl.push({
        type: "RentPaid",
        by: ev.args?.tenant,
        amount: ev.args?.amount?.toString?.() || String(ev.args?.amount || 0n),
        token: ev.args?.token,
        blockNumber: ev.blockNumber,
        tx: ev.transactionHash,
      });
    }
  } catch (_) {}

  try {
    const evs = await rent.queryFilter(rent.filters.CancellationInitiated?.());
    for (const ev of evs) {
      tl.push({ type: "CancellationInitiated", by: ev.args?.[0], blockNumber: ev.blockNumber, tx: ev.transactionHash });
    }
  } catch (_) {}
  try {
    const evs = await rent.queryFilter(rent.filters.CancellationApproved?.());
    for (const ev of evs) {
      tl.push({ type: "CancellationApproved", by: ev.args?.[0], blockNumber: ev.blockNumber, tx: ev.transactionHash });
    }
  } catch (_) {}
  try {
    const evs = await rent.queryFilter(rent.filters.CancellationFinalized?.());
    for (const ev of evs) {
      tl.push({ type: "CancellationFinalized", by: ev.args?.[0], blockNumber: ev.blockNumber, tx: ev.transactionHash });
    }
  } catch (_) {}

  // Attach timestamps
  for (const item of tl) {
    item.at = await loadBlockTime(item.blockNumber);
  }
  // Sort by blockNumber
  tl.sort((a, b) => a.blockNumber - b.blockNumber);
  return tl;
}

async function main() {
  const factoryAddress = readFactoryAddress();
  const factory = await ethers.getContractAt("ContractFactory", factoryAddress);

  console.log(`Network: ${network.name}`);
  console.log(`Factory: ${factoryAddress}`);

  const contracts = await factory.getAllContracts();
  console.log(`Total contracts: ${contracts.length}`);

  for (const addr of contracts) {
    try {
      const rent = await ethers.getContractAt("TemplateRentContract", addr);
      const [landlord, tenant, isActive] = await Promise.all([
        rent.landlord(),
        rent.tenant(),
        rent.active().catch(() => true),
      ]);
      console.log("\n--- Rent Contract:", addr);
      console.log("Landlord:", landlord);
      console.log("Tenant:  ", tenant);
      console.log("Active:  ", isActive);

      const tl = await timelineForRent(addr);
      if (!tl.length) {
        console.log("(no events)");
        continue;
      }
      console.log("Timeline:");
      for (const item of tl) {
        if (item.type === "RentPaid") {
          // amount in ETH (wei to ether)
          let eth = "";
          try { eth = ethers.formatEther(item.amount); } catch { eth = item.amount; }
          console.log(`  [${item.at}] ${item.type} – payer=${item.by} amount=${eth} ETH tx=${item.tx}`);
        } else {
          console.log(`  [${item.at}] ${item.type} – by=${item.by} tx=${item.tx}`);
        }
      }
    } catch (e) {
      console.log(`\n--- Contract ${addr} (could not decode as rent): ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
