import "dotenv/config";
import pkg from "hardhat";
import fs from "fs";
import path from "path";

const { ethers, network } = pkg;

// Multi-case e2e: create 5 NDA + 5 Rent contracts, report cases, request resolution,
// and simulate fulfillment locally via OracleArbitratorFunctions.testFulfill.

async function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function short(addr){ return addr ? addr.toString().slice(0,10) : addr; }

async function deployIfMissing(name){
  const Factory = await ethers.getContractFactory(name);
  const deployed = await Factory.deploy();
  await deployed.waitForDeployment();
  return deployed;
}

async function main(){
  console.log("▶ Starting e2e_local_flow on network:", network.name);
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const others = signers.slice(1);

  // Load test data
  const ndaData = await readJson(path.join(process.cwd(), 'test', 'data', 'nda_cases_normalized.json'));
  const rentData = await readJson(path.join(process.cwd(), 'test', 'data', 'rent_disputes.json'));

  if(ndaData.length < 5 || rentData.length < 5) throw new Error('Need at least 5 NDA and 5 Rent cases in test/data');

  // Deploy ContractFactory
  console.log('Deploying ContractFactory...');
  const ContractFactory = await ethers.getContractFactory('ContractFactory');
  const factory = await ContractFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log('\u2705 ContractFactory:', factoryAddr);

  // Deploy OracleArbitratorFunctions with no router (we'll use testFulfill)
  console.log('Deploying OracleArbitratorFunctions...');
  const Oracle = await ethers.getContractFactory('OracleArbitratorFunctions');
  const oracle = await Oracle.deploy(ethers.ZeroAddress); // router zero; we still can call testFulfill
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log('\u2705 OracleArbitratorFunctions:', oracleAddr);

  // Create NDA contracts via factory: we'll create 5 NDAs with alternating signers
  console.log('Creating NDA contracts...');
  const NDATemplateFactory = await ethers.getContractFactory('NDATemplate');
  const createdNdas = [];
  for(let i=0;i<5;i++){
    const A = signers[i % signers.length];
    const B = signers[(i+1) % signers.length];
    const expiry = Math.floor(Date.now()/1000) + 3600;
    const penaltyBps = 5000;
    const customHash = ethers.keccak256(ethers.toUtf8Bytes('e2e'));
    const minDeposit = ethers.parseEther('0.01');
  // factory.createNDA uses msg.sender as partyA, so connect as A
  const tx = await factory.connect(A).createNDA(B.address, expiry, penaltyBps, customHash, oracleAddr, minDeposit);
  const rc = await tx.wait();
  let ndaAddr = null;
  for(const lg of rc.logs){ try { const parsed = factory.interface.parseLog(lg); if(parsed && parsed.name==='NDACreated'){ ndaAddr = parsed.args[0]; break; } } catch{} }
    if(!ndaAddr) {
      // Fallback: attempt to read from events in block
      console.warn('Could not parse NDA address from factory logs');
    }
    createdNdas.push(ndaAddr);
    console.log(' NDA', i, ndaAddr);
  }

  // Create Rent contracts similarly
  console.log('Creating Rent contracts...');
  const createdRents = [];
  // Deploy a MockPriceFeed to satisfy createRentContract contract check
  const MockPriceFeed = await ethers.getContractFactory('MockPriceFeed');
  const mockPrice = await MockPriceFeed.deploy(2000);
  await mockPrice.waitForDeployment();
  const mockPriceAddr = await mockPrice.getAddress();
  console.log(' MockPriceFeed:', mockPriceAddr);

  for(let i=0;i<5;i++){
    const landlord = signers[i % signers.length];
    const tenant = signers[(i+1) % signers.length];
    // createRentContract expects to be called by landlord (msg.sender)
  const tx = await factory.connect(landlord).createRentContract(tenant.address, ethers.parseUnits('1',18), mockPriceAddr, 0);
    const rc = await tx.wait();
    let rentAddr = null;
    for(const lg of rc.logs){ try { const parsed = factory.interface.parseLog(lg); if(parsed && parsed.name==='RentContractCreated'){ rentAddr = parsed.args[0]; break; } } catch{} }
    createdRents.push(rentAddr);
    console.log(' Rent', i, rentAddr);
  }

  // For each created contract, deposit minimal deposits where needed and report cases from datasets
  const summary = [];
  // Helper to attach by code detection
  const ndaf = await ethers.getContractFactory('NDATemplate');
  const rentf = await ethers.getContractFactory('TemplateRentContract');

  // NDA cases: use first 5 entries
  for(let i=0;i<5;i++){
    const caseObj = ndaData[i];
    const ndaAddr = createdNdas[i];
    const nda = ndaf.attach(ndaAddr);
    // Reporter/offender correspond to partyA (creator) and partyB used at creation
    const reporter = signers[i % signers.length];
    const offender = signers[(i+1) % signers.length];

    // Ensure both deposit at least minDeposit
    const minDep = await nda.minDeposit();
    const repDep = await nda.deposits(reporter.address);
    const offDep = await nda.deposits(offender.address);
    if(repDep < minDep) await (await nda.connect(reporter).deposit({ value: minDep })).wait();
    if(offDep < minDep) await (await nda.connect(offender).deposit({ value: minDep })).wait();

    // Report breach (NDA requires requestedPenalty > 0)
    const requested = ethers.parseEther('0.001');
    const evidence = ethers.keccak256(ethers.toUtf8Bytes(caseObj.description || 'e2e-nda'));
    const tx = await nda.connect(reporter).reportBreach(offender.address, requested, evidence);
    const rc = await tx.wait();
    let caseId = null;
    for(const lg of rc.logs){ try { const p = nda.interface.parseLog(lg); if(p && p.name==='BreachReported'){ caseId = Number(p.args[0]); break; } } catch{} }
    console.log('Reported NDA case', caseObj.caseId, 'on', ndaAddr, 'caseId', caseId);

    // Request resolution
    const oracleContract = oracle.connect(reporter);
    const reqTx = await oracleContract.requestResolution(ndaAddr, caseId, offender.address, '0x');
    const reqRc = await reqTx.wait();
    let requestId = null;
    for(const lg of reqRc.logs){ try { const p = oracle.interface.parseLog(lg); if(p && p.name==='ResolutionRequested'){ requestId = p.args[0]; break; } } catch{} }
    console.log(' Requested requestId', requestId);

    // Call local AI endpoint to get a decision (uses GEMINI if GEMINI_API_KEY set in env)
    try {
      const aiUrl = process.env.AI_ENDPOINT_URL || 'http://127.0.0.1:8788';
      const aiPayload = {
        caseId: caseObj.caseId || String(caseId),
        domain: 'NDA',
        reporter: reporter.address,
        offender: offender.address,
        requestedPenaltyWei: requested.toString(),
        evidenceText: caseObj.description || ''
      };
      const aiHeaders = { 'content-type': 'application/json' };
      if (process.env.GEMINI_API_KEY) aiHeaders.authorization = `Bearer ${process.env.GEMINI_API_KEY}`;
      const aiRes = await fetch(aiUrl, { method: 'POST', headers: aiHeaders, body: JSON.stringify(aiPayload) });
      const aiDecision = await aiRes.json();
      // Use AI decision to fulfill via oracle.testFulfill (deployer is owner)
      const approve = !!aiDecision.approve;
      const penalty = aiDecision.penaltyWei ? aiDecision.penaltyWei : (aiDecision.awardedWei ? String(aiDecision.awardedWei) : '0');
      const beneficiary = aiDecision.beneficiary || deployer.address;
      const guilty = aiDecision.guilty || offender.address;
      const classification = aiDecision.classification || 'nda_auto';
      const rationale = aiDecision.rationale || 'auto-resolved';
  const tfTx = await oracle.connect(deployer).testFulfill(requestId, approve, penalty, beneficiary, guilty, classification, rationale);
  await tfTx.wait();
    } catch (err) {
      console.warn('AI request or fulfill failed, falling back to simulated baseline:', err.message);
      await oracle.connect(deployer).testFulfill(requestId, false, 0, deployer.address, offender.address, 'nda_default', 'e2e simulated fallback');
    }

  // Read case & meta
  const caseTuple = await nda.getCase(caseId);
  const meta = await nda.getCaseMeta(caseId);
  // include raw AI response if available
  const aiRaw = typeof aiDecision === 'object' ? (aiDecision._raw || aiDecision.text || null) : null;
  summary.push({ domain: 'nda', caseKey: caseObj.caseId, nda: ndaAddr, caseId, requestId: requestId, resolved: caseTuple[4], approved: caseTuple[5], classification: meta[0], rationale: meta[1], aiRaw });
  }

  // Rent cases: create disputes on created rent contracts
  for(let i=0;i<5;i++){
    const caseObj = rentData[i];
    const rentAddr = createdRents[i];
    const rent = rentf.attach(rentAddr);
    const landlord = signers[i % signers.length];
    const tenant = signers[(i+1) % signers.length];

    // Configure arbitrator and deposit if needed
    try{
      await rent.connect(landlord).configureArbitration(oracleAddr, ethers.parseEther('0.01'));
    }catch(e){}

    // Tenant deposit security if required
    try{ await (await rent.connect(tenant).depositSecurity({ value: ethers.parseEther('0.02') })).wait(); }catch(e){}

    // Reporter/offender mapping: use caseObj.reporter/offender addresses if they match signers; otherwise map
    const reporter = landlord;
    const offender = tenant;
  const requested = BigInt(caseObj.requestedPenaltyWei || 0);
  const disputeType = requested > 0 ? 0 : 1; // Damage if amount>0, otherwise a non-amount type
  const evidence = ethers.keccak256(ethers.toUtf8Bytes(caseObj.description || 'e2e-rent'));
    const tx = await rent.connect(reporter).reportDispute(disputeType, requested, evidence);
    const rc = await tx.wait();
    let caseId = null;
    for(const lg of rc.logs){ try { const p = rent.interface.parseLog(lg); if(p && p.name==='DisputeReported'){ caseId = Number(p.args[0]); break; } } catch{} }
    console.log('Reported Rent case', caseObj.caseId, 'on', rentAddr, 'caseId', caseId);


    // Instead of using OracleArbitratorFunctions (which expects NDA interface),
    // simulate the arbitrator by impersonating the oracle address and calling
    // resolveDisputeFinal on the rent contract directly.
    const requestId = ethers.keccak256(ethers.toUtf8Bytes(`${rentAddr}-${caseId}-${Date.now()}`));
    console.log(' Simulated requestId', requestId);

    // Ask AI for a decision for the rent dispute, then impersonate oracle to apply it
    let aiDecision = null;
    try {
      const aiUrl = process.env.AI_ENDPOINT_URL || 'http://127.0.0.1:8788';
      const aiPayload = {
        caseId: caseObj.caseId || String(caseId),
        domain: 'RENT',
        reporter: reporter.address,
        offender: offender.address,
        requestedPenaltyWei: String(requested),
        disputeType: caseObj.type || 'damage',
        evidenceText: caseObj.description || ''
      };
      const aiHeaders = { 'content-type': 'application/json' };
      if (process.env.GEMINI_API_KEY) aiHeaders.authorization = `Bearer ${process.env.GEMINI_API_KEY}`;
      const aiRes = await fetch(aiUrl, { method: 'POST', headers: aiHeaders, body: JSON.stringify(aiPayload) });
      aiDecision = await aiRes.json();
    } catch (err) {
      console.warn('AI request failed for rent case, falling back to defaults:', err.message);
    }

    const approve = aiDecision ? !!aiDecision.approve : true;
    const penaltyWei = aiDecision && aiDecision.penaltyWei ? aiDecision.penaltyWei : (requested > 0 ? String(requested) : String(ethers.parseEther('0.001')));
    const beneficiary = aiDecision && aiDecision.beneficiary ? aiDecision.beneficiary : reporter.address;
    const guilty = aiDecision && aiDecision.guilty ? aiDecision.guilty : offender.address;
    const classification = aiDecision && aiDecision.classification ? aiDecision.classification : 'rent_auto';
    const rationale = aiDecision && aiDecision.rationale ? aiDecision.rationale : 'auto-resolved';

    // Impersonate the oracle address (works on Hardhat network)
    try{
      // Fund the oracle address so it can send transactions when impersonated
      await ethers.provider.send('hardhat_setBalance', [oracleAddr, '0xde0b6b3a7640000']); // 1 ETH
      await ethers.provider.send('hardhat_impersonateAccount', [oracleAddr]);
      const oracleSigner = await ethers.getSigner(oracleAddr);
  const rdTx = await rent.connect(oracleSigner).resolveDisputeFinal(caseId, approve, penaltyWei, beneficiary, classification, rationale);
  await rdTx.wait();
    } catch(err){
      console.error('Impersonation/resolve failed:', err.message);
      throw err;
    } finally {
      try { await ethers.provider.send('hardhat_stopImpersonatingAccount', [oracleAddr]); } catch(e){}
    }

    // Read dispute & meta
  const dispute = await rent.getDispute(caseId);
  const dmeta = await rent.getDisputeMeta(caseId);
  const aiRawRent = aiDecision ? (aiDecision._raw || aiDecision.text || null) : null;
  summary.push({ domain: 'rent', caseKey: caseObj.caseId, rent: rentAddr, caseId, requestId, resolved: dispute[4], approved: dispute[5], applied: dispute[6].toString(), classification: dmeta[0], rationale: dmeta[1], aiRaw: aiRawRent });
  }

  // Write summary
  const outPath = path.join(process.cwd(), 'scripts', 'e2e_local_summary.json');
  fs.writeFileSync(outPath, JSON.stringify({ network: network.name, timestamp: new Date().toISOString(), summary }, null, 2));
  console.log('\u2705 e2e complete. Summary ->', outPath);
  console.table(summary.map(s => ({ domain: s.domain, case: s.caseKey, addr: short(s.nda || s.rent), caseId: s.caseId })) );
}

main().catch(e => { console.error('\u274c e2e_local_flow failed:', e); process.exit(1); });
