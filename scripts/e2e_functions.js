import "dotenv/config";
import pkg from "hardhat";
const { ethers } = pkg;

/*
 End-to-end script:
 1. Uses existing deployed OracleArbitratorFunctions (ORACLE_FUNCTIONS_ADDR env)
 2. Deploys a fresh NDATemplate pointing at that oracle as arbitrator
 3. Parties deposit
 4. Reporter opens breach case
 5. Calls requestResolution on oracle (expects configured Functions)
 6. Waits for ResolutionFulfilled (polling events)

 Env required:
  - ORACLE_FUNCTIONS_ADDR
  - CLF_SUBSCRIPTION_ID / CLF_DON_ID / CLF_GAS_LIMIT already set & configured previously
  - AI_ENDPOINT_URL (optional) for off-chain decision

 If Functions not configured fully, oracle will emit ResolutionRequested only; you can then simulate with testFulfill.
*/

async function main() {
  const oracleAddr = process.env.ORACLE_FUNCTIONS_ADDR;
  if (!oracleAddr || !ethers.isAddress(oracleAddr)) {
    throw new Error("Missing ORACLE_FUNCTIONS_ADDR env or invalid address");
  }
  console.log("▶ Using OracleArbitratorFunctions:", oracleAddr);

  const [a,b] = await ethers.getSigners();
  console.log("Parties:", a.address, b.address);

  // Deploy NDA with oracle as arbitrator
  const NDATemplate = await ethers.getContractFactory("NDATemplate");
  const expiry = Math.floor(Date.now()/1000) + 3600; // +1h
  const penaltyBps = 5000; // 50%
  const customClausesHash = ethers.keccak256(ethers.toUtf8Bytes("demo"));
  const minDeposit = ethers.parseEther("0.1");
  const nda = await NDATemplate.deploy(a.address, b.address, expiry, penaltyBps, customClausesHash, oracleAddr, minDeposit);
  await nda.waitForDeployment();
  const ndaAddr = await nda.getAddress();
  console.log("✅ NDA deployed:", ndaAddr);

  // Both deposit
  await (await nda.connect(a).deposit({ value: ethers.parseEther("0.3") })).wait();
  await (await nda.connect(b).deposit({ value: ethers.parseEther("0.4") })).wait();
  console.log("💰 Deposits done.");

  // Reporter (A) reports breach against B
  const requestedPenalty = ethers.parseEther("0.2");
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("source_code breach test"));
  const reportTx = await nda.connect(a).reportBreach(b.address, requestedPenalty, evidenceHash);
  const reportRc = await reportTx.wait();
  let caseId = null;
  for (const lg of reportRc.logs) {
    try { const parsed = nda.interface.parseLog(lg); if (parsed && parsed.name === "BreachReported") { caseId = Number(parsed.args[0]); break; } } catch {}
  }
  if (caseId === null) throw new Error("Could not parse caseId");
  console.log("🕵️ Breach reported. caseId=", caseId);

  // Call oracle.requestResolution
  const Oracle = await ethers.getContractFactory("OracleArbitratorFunctions");
  const oracle = Oracle.attach(oracleAddr).connect(a);
  const reqTx = await oracle.requestResolution(ndaAddr, caseId, b.address, "0x");
  const reqRc = await reqTx.wait();
  let requestId = null;
  for (const lg of reqRc.logs) {
    try { const parsed = oracle.interface.parseLog(lg); if (parsed && parsed.name === "ResolutionRequested") { requestId = parsed.args[0]; break; } } catch {}
  }
  console.log("📨 ResolutionRequested requestId=", requestId);

  console.log("⏳ Waiting for ResolutionFulfilled (up to ~3 minutes)...");
  const start = Date.now();
  const provider = ethers.provider;
  const filter = {
    address: oracleAddr,
    topics: [oracle.interface.getEvent("ResolutionFulfilled").topicHash]
  };
  while (Date.now() - start < 180000) { // 3 min
    const logs = await provider.getLogs({ ...filter, fromBlock: reqRc.blockNumber, toBlock: "latest" });
    for (const lg of logs) {
      try {
        const parsed = oracle.interface.parseLog(lg);
        if (parsed && parsed.name === "ResolutionFulfilled" && parsed.args[0] === requestId) {
          const approve = parsed.args[3];
          const penalty = parsed.args[4];
          const beneficiary = parsed.args[5];
          const guilty = parsed.args[6];
          console.log("✅ Fulfilled:", { approve, penalty: penalty.toString(), beneficiary, guilty });
          const meta = await nda.getCaseMeta(caseId);
          console.log("ℹ️ Classification:", meta[0], "Rationale:", meta[1]);
          return;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 8000));
  }
  console.warn("⚠️ Timeout waiting for ResolutionFulfilled. If Functions not configured, use testFulfill().");
}

main().catch(e => { console.error("❌ e2e_functions failed:", e); process.exit(1); });
