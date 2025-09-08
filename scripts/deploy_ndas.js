import 'dotenv/config';
import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { ethers, network } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
Unified NDA deployment script.
Modes:
  --mode minimal        -> Deploy (optionally) OracleArbitratorFunctions + one NDATemplate
  --mode archetypes     -> Deploy multiple NDATemplate contracts & cases from test/data/nda_archetypes.json

Shared ENV:
  ORACLE_FUNCTIONS_ADDR  (reuse existing oracle)
  ORACLE_FUNCTIONS_ROUTER (if deploying new oracle)

Minimal extra ENV:
  MIN_NDA_PENALTY_BPS (default 6000)
  MIN_NDA_MIN_DEPOSIT (default 0.05)
  MIN_NDA_EXPIRY_SECS (default 86400)

Archetypes extra ENV (same as previous script):
  ARCHETYPE_DEPOSIT_A (0.5) / ARCHETYPE_DEPOSIT_B (0.7)
  ARCHETYPE_PENALTY_BPS (6000)
  ARCHETYPE_MIN_DEPOSIT (0.05)
  ARCHETYPE_EXPIRY_SECS (86400)

Output:
  front/src/utils/contracts/
    - MinimalDeployment.json (minimal mode)
    - ArchetypeDeployments.json (archetypes mode)
    - *ABI.json for NDATemplate & OracleArbitratorFunctions

Usage examples:
  npx hardhat run scripts/deploy_ndas.js --network sepolia -- --mode minimal
  npx hardhat run scripts/deploy_ndas.js --network sepolia -- --mode archetypes
*/

function parseArgs(){
  // Priority: DEPLOY_MODE env -> --mode <x> / --mode=x -> positional 'minimal'|'archetypes'
  let mode = process.env.DEPLOY_MODE || 'minimal';
  const args = process.argv.slice(2);
  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === '--') continue; // delimiter
    if (a === '--mode' && args[i+1]) { mode = args[i+1]; break; }
    const eq = a.match(/^--mode=(.+)$/);
    if (eq){ mode = eq[1]; break; }
    if (/^(minimal|archetypes)$/.test(a)) { mode = a; }
  }
  return { mode };
}

async function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
async function copyAbi(contractPath, destDir){
  const name = path.basename(contractPath).replace('.sol','');
  const artifact = path.join(__dirname,'../artifacts/contracts',contractPath,`${name}.json`);
  if(!fs.existsSync(artifact)){ console.warn('⚠️  Missing artifact for', name); return; }
  const data = JSON.parse(fs.readFileSync(artifact,'utf8'));
  const out = { contractName: name, abi: data.abi, bytecode: data.bytecode };
  fs.writeFileSync(path.join(destDir, `${name}ABI.json`), JSON.stringify(out,null,2));
  console.log(`✅ ABI copied: ${name}`);
}

async function deployOracleIfNeeded(){
  let oracleAddr = process.env.ORACLE_FUNCTIONS_ADDR?.trim();
  const isPlaceholder = oracleAddr && /YOUR_ORACLE_FUNCTIONS_ADDRESS/i.test(oracleAddr);
  const hasValid = oracleAddr && ethers.isAddress(oracleAddr);

  if(!oracleAddr || isPlaceholder || !hasValid){
    if (oracleAddr && !hasValid) {
      console.log('ℹ️  Ignoring invalid ORACLE_FUNCTIONS_ADDR value (will deploy new):', oracleAddr);
    }
    const router = process.env.ORACLE_FUNCTIONS_ROUTER;
    if(!router || !ethers.isAddress(router)) throw new Error('Missing ORACLE_FUNCTIONS_ROUTER (valid address) to deploy oracle');
    // On-chain code existence check to prevent silent hangs when router is wrong
    const code = await ethers.provider.getCode(router);
    if(!code || code === '0x') {
      throw new Error(`ORACLE_FUNCTIONS_ROUTER ${router} has no contract code on ${network.name}. Verify the official Chainlink Functions router address.`);
    }
    console.log('Deploying OracleArbitratorFunctions with router', router);
    const Oracle = await ethers.getContractFactory('OracleArbitratorFunctions');
    const oracle = await Oracle.deploy(router);
    await oracle.waitForDeployment();
    oracleAddr = await oracle.getAddress();
    console.log('✅ OracleArbitratorFunctions deployed:', oracleAddr);
  } else {
    console.log('Reusing existing OracleArbitratorFunctions:', oracleAddr);
  }
  return oracleAddr;
}

async function runMinimal(){
  const signerList = await ethers.getSigners();
  let deployer = signerList[0];
  let second = signerList[1];
  if (!second) {
    if (process.env.SECOND_PRIVATE_KEY) {
      try {
        second = new ethers.Wallet(process.env.SECOND_PRIVATE_KEY, ethers.provider);
        console.log('Loaded second signer from SECOND_PRIVATE_KEY:', second.address);
      } catch (e) {
        throw new Error('Failed to init SECOND_PRIVATE_KEY wallet: ' + e.message);
      }
    } else {
      throw new Error('Need SECOND_PRIVATE_KEY in .env (second funded account) for minimal mode on public network.');
    }
  }
  const oracleAddr = await deployOracleIfNeeded();

  const expiry = Math.floor(Date.now()/1000) + Number(process.env.MIN_NDA_EXPIRY_SECS || 86400);
  const penaltyBps = Number(process.env.MIN_NDA_PENALTY_BPS || 6000);
  const minDeposit = ethers.parseEther(process.env.MIN_NDA_MIN_DEPOSIT || '0.05');
  const customHash = ethers.keccak256(ethers.toUtf8Bytes('minimal'));

  const NDATemplate = await ethers.getContractFactory('NDATemplate');
  const nda = await NDATemplate.deploy(deployer.address, second.address, expiry, penaltyBps, customHash, oracleAddr, minDeposit);
  await nda.waitForDeployment();
  const ndaAddr = await nda.getAddress();
  console.log('✅ NDATemplate deployed:', ndaAddr);

  const frontDir = path.join(__dirname,'../front/src/utils/contracts');
  await ensureDir(frontDir);
  copyAbi('NDA/NDATemplate.sol', frontDir);
  copyAbi('NDA/OracleArbitratorFunctions.sol', frontDir);
  fs.writeFileSync(path.join(frontDir,'MinimalDeployment.json'), JSON.stringify({ network: network.name, oracle: oracleAddr, nda: ndaAddr, timestamp: new Date().toISOString() }, null, 2));
  console.log('💾 Wrote MinimalDeployment.json');

  console.log('\nNext steps: fund subscription, add oracle consumer, npm run functions:config, open a case.');
}

async function runArchetypes(){
  const signerList = await ethers.getSigners();
  let A = signerList[0];
  let B = signerList[1];
  if (!B) {
    if (process.env.SECOND_PRIVATE_KEY) {
      try {
        B = new ethers.Wallet(process.env.SECOND_PRIVATE_KEY, ethers.provider);
        console.log('Loaded second signer from SECOND_PRIVATE_KEY:', B.address);
      } catch (e) {
        throw new Error('Failed to init SECOND_PRIVATE_KEY wallet: ' + e.message);
      }
    } else {
      throw new Error('Archetypes mode requires two funded signers on a public network. Set SECOND_PRIVATE_KEY in .env or use deploy:minimal.');
    }
  }
  const oracle = process.env.ORACLE_FUNCTIONS_ADDR && ethers.isAddress(process.env.ORACLE_FUNCTIONS_ADDR) ? process.env.ORACLE_FUNCTIONS_ADDR : ethers.ZeroAddress;
  if (oracle === ethers.ZeroAddress) console.log('ℹ️  No oracle address set – voting mode.'); else console.log('▶ Using oracle:', oracle);

  const depA = ethers.parseEther(process.env.ARCHETYPE_DEPOSIT_A || '0.5');
  const depB = ethers.parseEther(process.env.ARCHETYPE_DEPOSIT_B || '0.7');
  const penaltyBps = Number(process.env.ARCHETYPE_PENALTY_BPS || 6000);
  const minDeposit = ethers.parseEther(process.env.ARCHETYPE_MIN_DEPOSIT || '0.05');
  const expiry = Math.floor(Date.now()/1000) + Number(process.env.ARCHETYPE_EXPIRY_SECS || 86400);

  const filePath = path.join(__dirname,'../test/data/nda_archetypes.json');
  const items = JSON.parse(fs.readFileSync(filePath,'utf8'));
  const NDATemplate = await ethers.getContractFactory('NDATemplate');
  const results = [];

  for (const entry of items){
    const name = entry.name; console.log(`\n🆕 Archetype: ${name}`);
    const customHash = ethers.keccak256(ethers.toUtf8Bytes(name));
    const nda = await NDATemplate.deploy(A.address, B.address, expiry, penaltyBps, customHash, oracle, minDeposit);
    await nda.waitForDeployment();
    const ndaAddr = await nda.getAddress(); console.log('  NDA:', ndaAddr);
    await (await nda.connect(A).deposit({ value: depA })).wait();
    await (await nda.connect(B).deposit({ value: depB })).wait();
    console.log('  Deposits funded.');

    const reporter = entry.reporter === 'A' ? A.address : B.address;
    const offender = entry.offender === 'A' ? A.address : B.address;
    const requestedWei = ethers.parseEther(entry.requestedEth);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(entry.evidence));

    const repTx = await nda.connect(reporter === A.address ? A : B).reportBreach(offender, requestedWei, evidenceHash);
    const repRc = await repTx.wait();
    let caseId = null; for (const lg of repRc.logs){ try { const parsed = nda.interface.parseLog(lg); if(parsed && parsed.name==='BreachReported'){ caseId = Number(parsed.args[0]); break; } } catch {} }
    if (caseId === null) throw new Error('Could not parse caseId');
    console.log('  Case opened:', caseId);

    let resolutionRequested = false;
    if (oracle !== ethers.ZeroAddress){
      try {
        const Oracle = await ethers.getContractFactory('OracleArbitratorFunctions');
        const oracleCtr = Oracle.attach(oracle).connect(A);
        const tx = await oracleCtr.requestResolution(ndaAddr, caseId, offender, '0x');
        await tx.wait();
        resolutionRequested = true;
        console.log('  Resolution requested.');
      } catch (e){ console.warn('  ⚠️ requestResolution failed:', e.message); }
    }

    results.push({ name, nda: ndaAddr, caseId, reporter, offender, requestedPenaltyWei: requestedWei.toString(), oracle: oracle===ethers.ZeroAddress?null:oracle, resolutionRequested });
  }

  const frontDir = path.join(__dirname,'../front/src/utils/contracts');
  await ensureDir(frontDir);
  copyAbi('NDA/NDATemplate.sol', frontDir);
  copyAbi('NDA/OracleArbitratorFunctions.sol', frontDir);
  fs.writeFileSync(path.join(frontDir,'ArchetypeDeployments.json'), JSON.stringify({ network: network.name, items: results }, null, 2));
  console.log('\n💾 Wrote ArchetypeDeployments.json with', results.length, 'entries.');
}

async function main(){
  const { mode } = parseArgs();
  console.log('▶ Mode:', mode, 'Network:', network.name);
  if (mode === 'minimal') await runMinimal();
  else if (mode === 'archetypes') await runArchetypes();
  else throw new Error('Unknown --mode value');
}

main().catch(e=>{ console.error('❌ deploy_ndas failed:', e); process.exit(1); });
