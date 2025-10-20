#!/usr/bin/env node
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main(){
  const provider = new ethers.JsonRpcProvider(process.env.E2E_RPC_URL || 'http://127.0.0.1:8545');
  let ndaAddr = process.env.NDA_ADDRESS;
  // Prefer explicit private key from env; declare here so it's available later
  let creatorPrivateKey = process.env.E2E_PRIVATE_KEY || null;
  let offenderPrivateKey = process.env.E2E_OFFENDER_PRIVATE_KEY || null;

  // If NDA_ADDRESS not provided, attempt to create one via ContractFactory
  if (!ndaAddr) {
    console.log('NDA_ADDRESS not set — attempting to create an NDA via ContractFactory with defaults.');
    // Find deployment summary for ContractFactory
    const deployPath = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
    let factoryAddr = null;
    if (fs.existsSync(deployPath)){
      try{
        const summary = JSON.parse(fs.readFileSync(deployPath,'utf8'));
        factoryAddr = summary?.contracts?.ContractFactory || summary?.contracts?.factory || null;
      }catch(e){}
    }
    if (!factoryAddr){
      // fallback to root deployment-summary
      const rootDeploy = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
      if (fs.existsSync(rootDeploy)){
        try{const s=JSON.parse(fs.readFileSync(rootDeploy,'utf8')); factoryAddr = s?.contracts?.ContractFactory||s?.contracts?.factory||null;}catch(e){}
      }
    }

    if (!factoryAddr){
      console.error('ContractFactory address not found in front/src/utils/contracts/deployment-summary.json — provide NDA_ADDRESS or add ContractFactory to deployment summary.');
      process.exit(2);
    }

    console.log('Using ContractFactory at', factoryAddr);
    // Load ContractFactory ABI
    const factoryAbiPath = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'ContractFactory.json');
    let factoryAbi = null;
    if (fs.existsSync(factoryAbiPath)) factoryAbi = JSON.parse(fs.readFileSync(factoryAbiPath,'utf8')).abi;
    if (!factoryAbi) {
      console.error('ContractFactory ABI not found at', factoryAbiPath);
      process.exit(2);
    }

    // Prefer explicit private key from env; otherwise try to read WALLETS.txt for local dev keys
    // (creatorPrivateKey and offenderPrivateKey were declared above)
    if (!creatorPrivateKey || !offenderPrivateKey) {
      const walletsPath = path.resolve(__dirname, '..', '..', 'WALLETS.txt');
      if (fs.existsSync(walletsPath)){
        const txt = fs.readFileSync(walletsPath,'utf8');
        const matches = [...txt.matchAll(/Private Key:\s*(0x[0-9a-fA-F]{64})/g)].map(m=>m[1]);
        if (!creatorPrivateKey && matches.length>0) creatorPrivateKey = matches[0];
        if (!offenderPrivateKey && matches.length>1) offenderPrivateKey = matches[1];
      }
    }
    if (!creatorPrivateKey) {
      console.error('No creator private key available. Set E2E_PRIVATE_KEY or ensure WALLETS.txt exists with keys.');
      process.exit(2);
    }
    if (!offenderPrivateKey) {
      console.warn('No offender private key found; falling back to creator key for offender.');
      offenderPrivateKey = creatorPrivateKey;
    }

    const creatorSigner = new ethers.Wallet(creatorPrivateKey, provider);
    const factory = new ethers.Contract(factoryAddr, factoryAbi, creatorSigner);

    // Reasonable defaults (assumptions): expiryDate = now + 30d, penaltyBps = 100 (1%), customClausesHash = 0x0, minDeposit = 0.01 ETH, payFeesIn = 0 (ETH)
    const now = Math.floor(Date.now()/1000);
    const expiry = now + 60*60*24*30; // 30 days
    const penaltyBps = 100;
  const customClausesHash = '0x' + '00'.repeat(32);
    const minDeposit = ethers.parseEther('0.01');
    const payFeesIn = 0;

  const accounts = await provider.listAccounts();
  const partyB = accounts[1] || (new ethers.Wallet(offenderPrivateKey || creatorPrivateKey, provider)).address;
  console.log('Creating NDA with partyB (offender) as', partyB);
    console.log('Defaults: expiry=',expiry,'penaltyBps=',penaltyBps,'minDeposit=',String(minDeposit),'payFeesIn=',payFeesIn);

  const tx = await factory.connect(creatorSigner).createNDA(partyB, expiry, penaltyBps, customClausesHash, minDeposit, payFeesIn);
    console.log('createNDA tx hash:', tx.hash);
    const rec = await tx.wait();
    // find NDACreated event
    const iface = new ethers.Interface(factoryAbi);
    let newAddr = null;
    for (const log of rec.logs){
      try{
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === 'NDACreated'){
          newAddr = parsed.args && parsed.args[0];
          break;
        }
      }catch(e){}
    }
    if (!newAddr){
      // try to read return value from tx (some factories return the address)
      try{ if (rec && rec.events){ for (const ev of rec.events){ if (ev.event === 'NDACreated' && ev.args) { newAddr = ev.args[0]; break; } } } }catch(e){}
    }
    if (!newAddr){
      console.error('Could not determine new NDA address from logs. Tx receipt:', JSON.stringify(rec, null, 2));
      process.exit(3);
    }
    ndaAddr = newAddr;
    console.log('Created NDATemplate at', ndaAddr);
  }

  // Load ABI from front utils or artifacts
  const frontNDAPath = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'NDATemplate.json');
  const artifactNDAPath = path.resolve(__dirname, '..', '..', 'artifacts', 'contracts', 'NDA', 'NDATemplate.sol', 'NDATemplate.json');
  let ndaAbiJson = null;
  if (fs.existsSync(frontNDAPath)) ndaAbiJson = JSON.parse(fs.readFileSync(frontNDAPath, 'utf8'));
  else if (fs.existsSync(artifactNDAPath)) ndaAbiJson = JSON.parse(fs.readFileSync(artifactNDAPath, 'utf8'));

  const abi = ndaAbiJson ? (ndaAbiJson.abi || ndaAbiJson) : [
    'function isParty(address) external view returns (bool)',
    'function minDeposit() external view returns (uint256)',
    'function deposit() external payable',
    'function disputeFee() external view returns (uint256)',
  ];

  // Use signer index 1 as offender (Hardhat default second account)
  const accts = await provider.listAccounts();
  const offenderAddress = accts[1] || (await creatorSigner.getAddress());
  const offenderSigner = new ethers.Wallet(offenderPrivateKey || creatorSigner.privateKey, provider);

  const nda = new ethers.Contract(ndaAddr, abi, offenderSigner);

  try {
    // NDATemplate does not expose 'isParty' as a public getter; check partyA/partyB instead
    const partyA = await nda.partyA().catch(()=>null);
    const partyB = await nda.partyB().catch(()=>null);
    const isPartyFlag = (partyA && String(partyA).toLowerCase() === String(offenderAddress).toLowerCase()) || (partyB && String(partyB).toLowerCase() === String(offenderAddress).toLowerCase());
    console.log('Offender address:', offenderAddress, 'partyA=', partyA, 'partyB=', partyB, 'isParty=', isPartyFlag);

    // Read minDeposit if available
    let minDep = ethers.Zero;
    try { minDep = await nda.minDeposit(); } catch(e) { minDep = ethers.Zero; }
    console.log('minDeposit=', String(minDep || '0'));

    // Read current deposits for offender if available
    let currentDeposit = 0n;
    try { currentDeposit = await nda.deposits(offenderAddress); } catch(e) { currentDeposit = 0n; }
    console.log('currentDeposit=', String(currentDeposit || '0'));

    if (!minDep || minDep === ethers.Zero) {
      console.log('No minDeposit required; nothing to deposit');
      return;
    }

    if (currentDeposit >= minDep) {
      console.log('Offender already has sufficient deposit; skipping deposit.');
      return;
    }

    console.log('Sending deposit from offender signer (index 1 / address=', offenderAddress, ')');
    const ndaWithOffender = nda.connect(offenderSigner);
    const tx = await ndaWithOffender.deposit({ value: minDep });
    console.log('Deposit tx hash:', tx.hash);
    const rec = await tx.wait();
    console.log('Deposit mined, status=', rec.status);
  } catch (err) {
    console.error('Error during NDA setup:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main().catch(err=>{ console.error(err); process.exit(1); });
