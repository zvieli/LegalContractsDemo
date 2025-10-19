#!/usr/bin/env node
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function loadDeployment() {
  const p = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
  if (!fs.existsSync(p)) throw new Error('deployment-summary.json not found at ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function short(x){ return x && typeof x === 'string' ? x.slice(0, 20) : x; }

async function tryCall(contract, fnName, args = [], overrides = {}){
  try {
    console.log(`Calling ${contract.address}.${fnName}(${args.map(a=>short(a)).join(', ')}) with overrides ${JSON.stringify(overrides)}`);
    const tx = await contract[fnName](...args, overrides);
    console.log('Tx sent, hash=', tx.hash);
    const rec = await tx.wait();
    console.log('Tx mined:', rec.transactionHash, 'status=', rec.status);
    return { receipt: rec };
  } catch (err) {
    // Try to surface revert reason
    console.error('Call threw:', err && err.message ? err.message : err);
    if (err && err.error && err.error.body) {
      try { console.error('Body:', JSON.parse(err.error.body)); } catch(e){}
    }
    return { error: err };
  }
}

async function probeCall(provider, to, data, from){
  try {
    const res = await provider.call({ to, data, from });
    console.log('Static call returned (no revert):', res);
    return { res };
  } catch (err) {
    console.error('Static call reverted:', err && (err.error?.message || err.message || err));
    return { error: err };
  }
}

async function main(){
  const provider = new ethers.JsonRpcProvider(process.env.E2E_RPC_URL || 'http://127.0.0.1:8545');
  const deploy = await loadDeployment();

  const signerKey = process.env.E2E_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const signer = new ethers.Wallet(signerKey, provider);

  // 1) Enhanced Rent: call the correct function if present
  try {
    const rentAddr = deploy.contracts && deploy.contracts.EnhancedRentContract && deploy.contracts.EnhancedRentContract.address || deploy.contracts && deploy.contracts.EnhancedRentContract;
    if (!rentAddr) console.warn('EnhancedRentContract address missing in deployment-summary.json');
    else {
      // Attempt to find a plausible ABI entry: reportDispute or reportDispute( ... )
      const rentAbiCandidates = [
        'function reportDispute(uint8,uint256,string) external payable',
        'function reportDispute(uint8,uint256) external payable',
        'function reportDispute(uint8,uint256,string) external',
        'function reportDispute(uint8,uint256) external'
      ];

      let rentContract = null;
      for (const sig of rentAbiCandidates){
        try {
          rentContract = new ethers.Contract(rentAddr, [sig], signer);
          // call static to see if selector exists (no state change)
          // we'll attempt a call that likely reverts but will show reason if available
          const calldata = rentContract.interface.encodeFunctionData(sig.split('(')[0].trim(), [0, 0]);
          await probeCall(provider, rentAddr, calldata, await signer.getAddress());
          console.log('Probed with ABI', sig);
          break;
        } catch(e){ rentContract = null; }
      }

      // If no candidate matched, try a generic minimal ABI
      if (!rentContract) {
        console.warn('Could not construct rentContract with candidates; attaching minimal ABI and trying raw selector for reportDispute');
        const minimal = ['function reportDispute() external'];
        rentContract = new ethers.Contract(rentAddr, minimal, signer);
      }

      // If contract object has reportDispute method, attempt to call with a plausible payload.
      if (typeof rentContract.reportDispute === 'function'){
        // Prepare plausible args: dtype=0 (Damage), requestedAmount=ethers.parseEther('0.1'), evidenceUri='test://e'
        const dtype = 0;
        const requested = ethers.parseEther('0.01');
        const evidenceUri = 'test-evidence://debug';
        // Many implementations expect msg.value to be the reporter bond/disputeFee; try retrieving disputeFee if available.
        let disputeFee = ethers.Zero;
        try { disputeFee = await rentContract.disputeFee(); } catch(e) { disputeFee = ethers.Zero; }
        console.log('Using disputeFee', disputeFee.toString());
        const res = await tryCall(rentContract, 'reportDispute', [dtype, requested, evidenceUri], { value: disputeFee });
        if (res.error) console.log('rent.reportDispute failed as above');
      } else {
        console.warn('rentContract has no reportDispute function (by this ABI).');
      }
    }
  } catch(e){ console.error('Error during EnhancedRentContract probe', e); }

  // 2) NDA flow: attach NDATemplate ABI and perform setup (deposits) then call reportBreach
  try {
    const ndaAddr = deploy.contracts && deploy.contracts.NDATemplate && deploy.contracts.NDATemplate.address || deploy.contracts && deploy.contracts.NDATemplate;
    if (!ndaAddr) console.warn('NDATemplate address missing in deployment-summary.json');
    else {
      const ndaAbi = [
        'function deposit() external payable',
        'function reportBreach(address offender,uint256 requestedPenalty,bytes32 evidenceHash,string evidenceURI) external payable returns (uint256)',
        'function disputeFee() external view returns (uint256)',
        'function minDeposit() external view returns (uint256)',
        'function isParty(address) external view returns (bool)'
      ];
      const nda = new ethers.Contract(ndaAddr, ndaAbi, signer);

      // pick two accounts: reporter (signer) and offender (another account)
      const reporter = signer;
      const all = await provider.send('eth_accounts', []);
      const offenderAddress = all && all[1] ? all[1] : (await provider.getBlock('latest')).hash.slice(0,42);

      console.log('Reporter', await reporter.getAddress(), 'Offender', offenderAddress);

      // Ensure both are parties - we can't easily set parties if factory pattern required; check isParty and warn
      try {
        const isOffenderParty = await nda.isParty(offenderAddress).catch(()=>false);
        const isReporterParty = await nda.isParty(await reporter.getAddress()).catch(()=>false);
        console.log('isOffenderParty=', isOffenderParty, 'isReporterParty=', isReporterParty);
      } catch(e){}

      // Ensure offender has deposit >= minDeposit: fetch minDeposit and deposit via signer for offender by using account 1 private key if available.
      let minDep = ethers.Zero;
      try { minDep = await nda.minDeposit(); } catch(e) { console.warn('Could not read minDeposit', e.message || e); }
      console.log('minDeposit=', minDep.toString());

      // If minDep > 0 and offender is an unlocked account in Hardhat, send funds from account[0] to offender so they can deposit
      if (!minDep.isZero()){
        const accounts = await provider.send('eth_accounts', []);
        if (accounts && accounts[1]){
          console.log('Funding offender with minDeposit from signer');
          // send ETH from signer to offender then call deposit from offender is not trivial here; we only check revert reason by submitting as reporter
        }
      }

      // Determine disputeFee
      let disputeFee = ethers.Zero;
      try { disputeFee = await nda.disputeFee(); } catch(e) { disputeFee = ethers.Zero; }
      console.log('nda.disputeFee=', disputeFee.toString());

      // Prepare call args
      const offender = offenderAddress;
      const requestedPenalty = ethers.parseEther('0.005');
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('debug-evidence'));
      const evidenceURI = 'ipfs://debug-evidence';

      // Try to call reportBreach from reporter: note many NDAs enforce isParty, deposit, and require(msg.value == disputeFee)
      const res = await tryCall(nda, 'reportBreach', [offender, requestedPenalty, evidenceHash, evidenceURI], { value: disputeFee });
      if (res.error) console.log('nda.reportBreach failed as above');
    }
  } catch(e){ console.error('Error during NDA probe', e); }
}

main().catch(err=>{ console.error('Fatal', err); process.exit(1); });
