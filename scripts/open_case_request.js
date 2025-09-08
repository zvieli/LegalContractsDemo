import 'dotenv/config';
import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';

const { ethers, network } = pkg;

function parseArgs(){
  const out = { nda: null, offender: 'B', requested: '0.05', evidence: 'default evidence', dry: false, partial: false };
  const argv = process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a==='--nda' && argv[i+1]) out.nda = argv[++i];
    else if(a==='--offender' && argv[i+1]) out.offender = argv[++i];
    else if(a==='--requested' && argv[i+1]) out.requested = argv[++i];
    else if(a==='--evidence' && argv[i+1]) out.evidence = argv[++i];
    else if(a==='--dry') out.dry = true;
    else if(a==='--partial') out.partial = true;
  }
  // Env fallbacks (Hardhat swallows custom --flags)
  if(process.env.OFFENDER) out.offender = process.env.OFFENDER;
  if(process.env.REQUESTED) out.requested = process.env.REQUESTED;
  if(process.env.EVIDENCE) out.evidence = process.env.EVIDENCE;
  if(process.env.PARTIAL === '1' || /true/i.test(process.env.PARTIAL||'')) out.partial = true;
  if(process.env.DRY === '1' || /true/i.test(process.env.DRY||'')) out.dry = true;
  return out;
}

async function loadNdaAddress(cli){
  if(cli) return cli;
  const minimalPath = path.join(process.cwd(),'front','src','utils','contracts','MinimalDeployment.json');
  if(fs.existsSync(minimalPath)){
    try { const j = JSON.parse(fs.readFileSync(minimalPath,'utf8')); if(j.nda) return j.nda; } catch {}
  }
  throw new Error('NDA address not provided and MinimalDeployment.json not found/invalid. Use --nda <address>.');
}

async function ensureSecondSigner(signers){
  if(signers[1]) return signers[1];
  const pk2 = process.env.SECOND_PRIVATE_KEY; if(!pk2) throw new Error('Missing SECOND_PRIVATE_KEY for second party');
  return new ethers.Wallet(pk2, ethers.provider);
}

async function main(){
  const args = parseArgs();
  const ndaAddr = await loadNdaAddress(args.nda);
  if(!ethers.isAddress(ndaAddr)) throw new Error('Invalid NDA address');
  const signers = await ethers.getSigners();
  const A = signers[0];
  const B = await ensureSecondSigner(signers);

  const NDATemplate = await ethers.getContractFactory('NDATemplate');
  const nda = NDATemplate.attach(ndaAddr);

  const oracleAddr = process.env.ORACLE_FUNCTIONS_ADDR;
  if(!oracleAddr || !ethers.isAddress(oracleAddr)) throw new Error('Missing ORACLE_FUNCTIONS_ADDR');
  const Oracle = await ethers.getContractFactory('OracleArbitratorFunctions');
  const oracle = Oracle.attach(oracleAddr);

  console.log(`Network: ${network.name}`);
  console.log('NDA:', ndaAddr);
  console.log('Oracle:', oracleAddr);

  const minDep = await nda.minDeposit();
  let depA = await nda.deposits(A.address);
  let depB = await nda.deposits(B.address);

  // Determine roles early for deposit logic
  const offenderSigner = args.offender === 'A' ? A : B;
  const reporterSigner = args.offender === 'A' ? B : A; // opposite
  if(offenderSigner.address === reporterSigner.address) throw new Error('Reporter and offender resolved to same address');

  async function ensureDeposit(partySigner, current, role){
    if(current >= minDep) return current;
    const need = minDep - current;
    if(args.dry){ console.log(`[dry] ${role} would deposit ${ethers.formatEther(need)} ETH`); return current; }
    // Check balance
    const bal = await ethers.provider.getBalance(partySigner.address);
    // Leave a small gas buffer (0.003 ETH)
    const buffer = ethers.parseEther('0.003');
    if(bal <= buffer){
      throw new Error(`${role} balance too low (${ethers.formatEther(bal)} ETH)`);
    }
    let toSend = need;
    if(bal - buffer < need){
      if(args.partial){
        toSend = bal - buffer;
        console.log(`⚠️  Partial deposit for ${role}: sending ${ethers.formatEther(toSend)} ETH (need ${ethers.formatEther(need)} ETH)`);
      } else {
        throw new Error(`${role} needs ${ethers.formatEther(need)} ETH deposit but only has ${ethers.formatEther(bal)} ETH (use --partial or fund more)`);
      }
    }
    if(toSend > 0){
      const tx = await nda.connect(partySigner).deposit({ value: toSend });
      await tx.wait();
      current += toSend;
    }
    return current;
  }

  depA = await ensureDeposit(A, depA, 'Party A');
  depB = await ensureDeposit(B, depB, 'Party B');

  // Enforce offender must have full min deposit (contract will revert otherwise)
  const offenderDep = offenderSigner.address === A.address ? depA : depB;
  if(offenderDep < minDep){
    throw new Error(`Offender deposit still below minimum (${ethers.formatEther(offenderDep)} < ${ethers.formatEther(minDep)}). Fund more or retry with sufficient balance.`);
  }

  const requestedWei = ethers.parseEther(args.requested);
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(args.evidence));

  if(args.dry){
    console.log('[dry] Would report breach with requested', args.requested, 'ETH evidenceHash', evidenceHash);
    return;
  }

  console.log('Reporting breach...');
  const repTx = await nda.connect(reporterSigner).reportBreach(offenderSigner.address, requestedWei, evidenceHash);
  const repRc = await repTx.wait();
  let caseId = null; for(const lg of repRc.logs){ try { const p = nda.interface.parseLog(lg); if(p.name==='BreachReported'){ caseId = Number(p.args[0]); break; } } catch {}
  }
  if(caseId===null) throw new Error('Could not extract caseId');
  console.log('Case ID:', caseId);

  // request resolution
  console.log('Requesting resolution via oracle...');
  const reqTx = await oracle.connect(reporterSigner).requestResolution(ndaAddr, caseId, offenderSigner.address, '0x');
  const reqRc = await reqTx.wait();
  let requestId = null; for(const lg of reqRc.logs){ try { const p = oracle.interface.parseLog(lg); if(p.name==='ResolutionRequested'){ requestId = p.args[0]; break; } } catch {}
  }
  console.log('Request ID:', requestId);

  // Write a small summary file
  const outDir = path.join(process.cwd(),'front','src','utils','contracts');
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir,{recursive:true});
  const summaryPath = path.join(outDir,'LastCaseRequest.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ network: network.name, nda: ndaAddr, oracle: oracleAddr, caseId, requestId, reporter: reporterSigner.address, offender: offenderSigner.address, requestedWei: requestedWei.toString(), timestamp: new Date().toISOString() }, null, 2));
  console.log('Saved summary ->', summaryPath);
  console.log('Done. Await fulfillment (ResolutionFulfilled event).');
}

main().catch(e=>{ console.error('❌ open_case_request failed:', e.message); process.exit(1); });
