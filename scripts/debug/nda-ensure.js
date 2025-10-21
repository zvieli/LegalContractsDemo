#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

function readJsonLenient(p) {
  let s = fs.readFileSync(p, 'utf8').trim();
  if (s.startsWith('```')) {
    const lines = s.split(/\r?\n/);
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length-1].startsWith('```')) lines.pop();
    s = lines.join('\n');
  }
  try { return JSON.parse(s); } catch (e) {}
  const start = s.indexOf('{'); if (start === -1) throw e;
  let depth=0, inString=false, prev='';
  for (let i=start;i<s.length;i++){ const ch=s[i]; if (ch==='"' && prev!=='\\') inString=!inString; if(!inString){ if(ch==='{') depth++; else if(ch==='}') depth--; if(depth===0){ const sub=s.slice(start,i+1); return JSON.parse(sub);} } prev=ch; }
}

function getPrivateKeys(workspaceRoot){
  const envA = process.env.E2E_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const envB = process.env.E2E_OFFENDER_PRIVATE_KEY || process.env.E2E_SECONDARY_PRIVATE_KEY;
  const keys = [];
  if (envA) keys.push(envA.replace(/^0x/,''));
  if (envB) keys.push(envB.replace(/^0x/,''));
  if (keys.length>=2) return keys.slice(0,2);
  const walletsFile = path.join(workspaceRoot,'WALLETS.txt');
  if (fs.existsSync(walletsFile)){
    const txt = fs.readFileSync(walletsFile,'utf8');
    const matches = Array.from(txt.matchAll(/0x[a-fA-F0-9]{64}/g)).map(m=>m[0]);
    if (matches.length>=2) return matches.slice(0,2).map(k=>k.replace(/^0x/,''));
  }
  return keys;
}

async function ensureActivation(ndaAddress, provider, pkA, pkB, debug){
  const walletA = new ethers.Wallet(pkA, provider);
  const walletB = new ethers.Wallet(pkB, provider);
  const repoRoot = path.resolve(__dirname,'..','..');
  const ndaAbiPath = path.join(repoRoot,'front','src','utils','contracts','NDATemplate.json');
  if (!fs.existsSync(ndaAbiPath)) throw new Error('NDATemplate ABI not found at '+ndaAbiPath);
  const ndaJson = readJsonLenient(ndaAbiPath);
  const ndaAbi = ndaJson.abi || ndaJson;
  const nda = new ethers.Contract(ndaAddress, ndaAbi, provider);

  // build typed data
  const chainId = (await provider.getNetwork()).chainId;
  const domain = { name: 'NDATemplate', version: '1', chainId: Number(chainId), verifyingContract: ndaAddress };
  const types = { NDA: [
    { name:'contractAddress', type:'address' },
    { name:'expiryDate', type:'uint256' },
    { name:'penaltyBps', type:'uint16' },
    { name:'customClausesHash', type:'bytes32' }
  ] };
  const expiryDate = await nda.expiryDate().catch(()=>0n);
  const penaltyBps = await nda.penaltyBps().catch(()=>0);
  const customClausesHash = await nda.customClausesHash().catch(()=>'0x' + '0'.repeat(64));
  const value = { contractAddress: ndaAddress, expiryDate: BigInt(expiryDate||0n), penaltyBps: Number(penaltyBps||0), customClausesHash };

  async function signTypedDataFallback(wallet){
    if (typeof wallet._signTypedData === 'function') return await wallet._signTypedData(domain, types, value);
    if (typeof wallet.signTypedData === 'function') return await wallet.signTypedData(domain, types, value);
    const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
    const hashStruct = ethers.TypedDataEncoder.hash(domain, types, value);
    const digest = ethers.keccak256(ethers.concat(['0x19','0x01', domainSeparator, hashStruct]));
    if (typeof wallet.signDigest === 'function') return await wallet.signDigest(digest);
    if (wallet._signingKey){ const sig = wallet._signingKey().signDigest(digest); return ethers.joinSignature(sig);} 
    throw new Error('No signing method on wallet');
  }

  // ensure sign
  for (const [wallet, label] of [[walletA,'A'],[walletB,'B']]){
    const addr = await wallet.getAddress();
    let already=false;
    if (typeof nda.signedBy==='function'){
      try{ already = await nda.signedBy(addr); }catch(e){}
    }
    if (!already){
      const sig = await signTypedDataFallback(wallet);
      const ndaWith = nda.connect(wallet);
      if (typeof ndaWith.signNDA !== 'function') throw new Error('NDATemplate missing signNDA');
      const tx = await ndaWith.signNDA(sig);
      await tx.wait();
    }
  }

  // deposits
  const minDep = BigInt((await nda.minDeposit().catch(()=>0n)).toString());
  if (minDep>0n){
    for (const wallet of [walletA,walletB]){
      const addr = await wallet.getAddress();
      let dep = 0n; try{ dep = BigInt((await nda.deposits(addr)).toString()); }catch(e){}
      if (dep < minDep){ const tx = await nda.connect(wallet).deposit({ value: minDep }); await tx.wait(); }
    }
  }

  const cs = Number(await nda.contractState().catch(()=>0));
  if (cs !== 2) throw new Error('ContractState is not Active after activation (state='+cs+')');
  return ndaAddress;
}

async function deployNDA(provider, creatorPk, offenderAddress){
  const repoRoot = path.resolve(__dirname,'..','..');
  const deployPath = path.join(repoRoot,'front','src','utils','contracts','deployment-summary.json');
  if (!fs.existsSync(deployPath)) throw new Error('deployment-summary.json not found at '+deployPath);
  const dep = readJsonLenient(deployPath);
  const factoryAddr = (dep && dep.contracts && (dep.contracts.ContractFactory || dep.contracts.factory)) || process.env.CONTRACT_FACTORY_ADDRESS;
  if (!factoryAddr) throw new Error('ContractFactory address not found in deployment-summary.json');
  const factoryAbiPath = path.join(repoRoot,'front','src','utils','contracts','ContractFactory.json');
  if (!fs.existsSync(factoryAbiPath)) throw new Error('ContractFactory ABI missing at '+factoryAbiPath);
  const factoryAbi = readJsonLenient(factoryAbiPath).abi || readJsonLenient(factoryAbiPath);
  const creator = new ethers.Wallet(creatorPk, provider);
  const factory = new ethers.Contract(factoryAddr, factoryAbi, creator);
  const now = Math.floor(Date.now()/1000);
  const expiry = now + 60*60*24*30;
  const penaltyBps = 100;
  const customs = '0x' + '00'.repeat(32);
  const minDeposit = ethers.parseEther('0.01');
  const payFeesIn = 0;
  const tx = await factory.createNDA(offenderAddress, expiry, penaltyBps, customs, minDeposit, payFeesIn);
  const rec = await tx.wait();
  const iface = new ethers.Interface(factoryAbi);
  let newAddr = null;
  for (const log of rec.logs){ try{ const parsed = iface.parseLog(log); if (parsed.name==='NDACreated'){ newAddr = parsed.args && parsed.args[0]; break; } }catch(e){} }
  if (!newAddr) {
    if (rec && rec.events){ for (const ev of rec.events){ if (ev.event==='NDACreated' && ev.args) { newAddr = ev.args[0]; break; } } }
  }
  if (!newAddr) throw new Error('Could not derive NDA address from createNDA tx');
  return newAddr;
}

async function writeDeploymentSummary(newAddr){
  const repoRoot = path.resolve(__dirname,'..','..');
  const deployPath = path.join(repoRoot,'front','src','utils','contracts','deployment-summary.json');
  if (!fs.existsSync(deployPath)) throw new Error('deployment-summary.json not found at '+deployPath);
  const json = readJsonLenient(deployPath) || {};
  json.contracts = json.contracts || {};
  json.contracts.NDATemplate = newAddr;
  fs.writeFileSync(deployPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

async function main(){
  const workspaceRoot = path.resolve(__dirname,'..','..');
  const providerUrl = process.env.E2E_RPC_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(providerUrl);
  try { await provider.getNetwork(); } catch(e){ console.error('RPC not reachable at', providerUrl); process.exit(2); }

  const deployPath = path.join(workspaceRoot,'front','src','utils','contracts','deployment-summary.json');
  let ndaAddr = null;
  if (fs.existsSync(deployPath)){
    const dep = readJsonLenient(deployPath);
    ndaAddr = dep && (dep.NDATemplate || (dep.contracts && dep.contracts.NDATemplate));
  }

  const keys = getPrivateKeys(workspaceRoot);
  if (keys.length < 2) {
    console.error('Need two private keys in env or WALLETS.txt');
    process.exit(1);
  }
  const [pkA, pkB] = keys;

  if (ndaAddr) {
    try {
      await ensureActivation(ndaAddr, provider, pkA, pkB, false);
      console.log('Existing NDA activated:', ndaAddr);
      await writeDeploymentSummary(ndaAddr);
      console.log('NDATemplate address persisted to deployment-summary.json');
      process.exit(0);
    } catch (e) {
      console.warn('Activation of existing NDA failed:', e && e.message ? e.message : e);
    }
  }

  const creatorPk = '0x'+pkA.replace(/^0x/,'');
  const offenderWallet = new ethers.Wallet('0x'+pkB.replace(/^0x/,''), provider);
  const offenderAddr = await offenderWallet.getAddress();
  const newAddr = await deployNDA(provider, creatorPk, offenderAddr);
  console.log('Deployed NDATemplate at', newAddr);
  await writeDeploymentSummary(newAddr);
  console.log('Wrote new NDATemplate to deployment-summary.json');
  await ensureActivation(newAddr, provider, pkA, pkB, true);
  console.log('Activation complete for', newAddr);
  process.exit(0);
}

main().catch(e=>{ console.error('nda-ensure failed:', e && e.message ? e.message : e); process.exit(1); });
