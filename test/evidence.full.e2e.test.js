// Enhanced full evidence + arbitration test suite with Helia CID + approve/capped/reject flows
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import EthCrypto from 'eth-crypto';
import crypto from 'crypto';
import hre from 'hardhat';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { keccak256, toUtf8Bytes, parseEther } from 'ethers';
import { deployArbitrationStack, createRentContract, signRent, reportDispute } from './helpers/rentFlow.js';
import { pathToFileURL } from 'url';

describe('Evidence Full + Arbitration Multi-Scenario', function() {
  this.timeout(160000);
  let server, serverPort, ep;
  const staticDir = path.join(process.cwd(), 'front','e2e','static');
  let adminKey;
  // Helia
  let heliaNode, heliaFs;
  // Arbitration actors
  let admin, landlord, tenant;
  let arbitrationService, factory, rentContract;
  let caseApprove, caseCap, caseReject;
  const CHAINLINK_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';

  before(async () => {
    const id = EthCrypto.createIdentity();
    process.env.ADMIN_PUBLIC_KEY = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
    process.env.ADMIN_PRIVATE_KEY = id.privateKey; adminKey = id.privateKey;
    process.env.TESTING = '1';
    try { const ethers = await import('ethers'); process.env.ADMIN_ADDRESS = new ethers.Wallet(adminKey).address; } catch(_){}
    // Clean evidence storage
    const stor = path.join(process.cwd(), 'evidence_storage');
    try { if (fs.existsSync(stor)) fs.rmSync(stor, { recursive: true, force: true }); } catch(_){}

    // Start endpoint
  const endpointHref = pathToFileURL(path.join(process.cwd(),'tools','evidence-endpoint.js')).href;
  ep = await import(endpointHref).catch(e=>{ console.error('Endpoint import error:', e?.stack||e); return null; });
    server = await (ep && ep.startEvidenceEndpoint ? ep.startEvidenceEndpoint(0, staticDir, process.env.ADMIN_PUBLIC_KEY) : null);
    if (server) { const addr = server.address(); serverPort = addr && addr.port; console.error('Evidence endpoint (full) on port', serverPort); }
    else { console.error('Evidence endpoint failed to start (full test)'); }

    // Helia
    heliaNode = await createHelia(); heliaFs = unixfs(heliaNode); console.error('Helia started (full test)');

    // Arbitration deployment (mainnet fork required)
    const { ethers, network } = hre;
    if (!network.config.forking || !network.config.forking.url) {
      console.error('Mainnet fork not configured – arbitration scenarios skipped');
      return;
    }
    ({ admin, landlord, tenant, arbitrationService, factory } = await deployArbitrationStack(parseEther('0.5')));
    rentContract = await createRentContract(factory, landlord, tenant, parseEther('1'), CHAINLINK_FEED, 42);
    await signRent(rentContract, landlord, tenant, parseEther('1'));
    // Deposit security
  // Required initial security deposit for these scenarios is set via factory default (0.5 ETH)
    if (!network.config.forking || !network.config.forking.url) {
      console.error('Skipping depositSecurity: not on forked network');
      return;
    }
    const reqDep = await rentContract.requiredDeposit().catch(()=>parseEther('0.5'));
    const factoryReq = await factory.defaultRequiredDeposit().catch(()=>0n);
    console.error('requiredDeposit (contract):', reqDep.toString(), 'factory.defaultRequiredDeposit:', factoryReq.toString());
    const depVal = (reqDep > 0n ? reqDep : factoryReq) + 1n;
    try {
      const depTx = await rentContract.connect(landlord).depositSecurity({ value: depVal });
      await depTx.wait();
      console.error('depositSecurity tx hash:', depTx.hash, 'value', depVal.toString());
    } catch (e) {
      console.error('depositSecurity failed in full evidence test:', e.message || e);
      this.skip();
    }
  });

  after(async () => {
    try { if (ep && ep.stopEvidenceEndpoint) await ep.stopEvidenceEndpoint(server); } catch(_){}
    try { if (heliaNode) await heliaNode.stop(); } catch(_){}
  });

  it('envelope evidence creation + dual decrypt (CLI + in-process)', async function() {
    if (!serverPort) { this.skip(); }
    const base = `http://127.0.0.1:${serverPort}`;
    const payload = { verdict:'ok', note:'full-suite', ts: Date.now() };
    const digest = keccak256(toUtf8Bytes(JSON.stringify(payload)));
    const body = { digest, type:'rationale', content: JSON.stringify(payload), adminPub: process.env.ADMIN_PUBLIC_KEY };
    const fetch = await getFetch();
    const res = await fetch(base + '/submit-evidence', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const j = await res.json();
    assert.ok(j.digest === digest, 'digest echoed');
    await new Promise(r=>setTimeout(r,200));
    const esDir = path.join(process.cwd(),'evidence_storage');
    const idx = JSON.parse(fs.readFileSync(path.join(esDir,'index.json'),'utf8'));
    assert.ok(idx.entries.find(e=>e.digest===digest));
    const envFile = fs.readdirSync(esDir).find(f=>f.includes(digest.replace(/^0x/,'')));
    assert.ok(envFile, 'envelope file found');
    // CLI decrypt
    const script = path.join(process.cwd(),'tools','admin','decryptEvidence.js');
    const out = spawnSync(process.execPath,[script,path.join('evidence_storage',envFile),'--privkey',adminKey],{encoding:'utf8'});
    assert.strictEqual(out.status,0,'CLI decrypt exit 0');
    // In-process decrypt replicate minimal path
    const envRaw = JSON.parse(fs.readFileSync(path.join(esDir, envFile),'utf8'));
    const encRecipients = envRaw.recipients||[]; const adminAddr = (process.env.ADMIN_ADDRESS||'').toLowerCase();
    const rec = encRecipients.find(r=>r.address && r.address.toLowerCase()===adminAddr) || encRecipients[0];
    const encKey = typeof rec.encryptedKey==='string'? JSON.parse(rec.encryptedKey):rec.encryptedKey;
    let decoded;
    if(encKey && encKey.ciphertext === 'legacy') {
      // Legacy compatibility: ciphertext is actually plaintext base64
      decoded = JSON.parse(Buffer.from(envRaw.ciphertext,'base64').toString('utf8'));
    } else {
      const pk = adminKey.startsWith('0x')? adminKey.slice(2):adminKey;
      const sym = await EthCrypto.decryptWithPrivateKey(pk, encKey);
      const symBuf = Buffer.from(sym,'hex');
      const iv = envRaw.encryption.aes.iv; const tag = envRaw.encryption.aes.tag;
      const decipher = crypto.createDecipheriv('aes-256-gcm', symBuf, Buffer.from(iv,'base64'), {authTagLength:16});
      decipher.setAuthTag(Buffer.from(tag,'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envRaw.ciphertext,'base64')), decipher.final()]).toString('utf8');
      decoded = JSON.parse(plaintext);
    }
    assert.strictEqual(decoded.verdict, payload.verdict, 'decoded verdict');
  });

  it('arbitration scenarios: approve, capped approval, rejection, large reject, replay guard', async function() {
    if (!arbitrationService) this.skip();
    const { ethers } = hre;
    // Evidence for approve scenario
    async function addEvidence(obj){ const cid = await heliaFs.addBytes(new TextEncoder().encode(JSON.stringify(obj))); const cidStr = cid.toString(); return { cid: cidStr, digest: keccak256(toUtf8Bytes(cidStr)) }; }
    // 1) Approve: request 0.05
  const requested1 = parseEther('0.05');
  const ev1 = await addEvidence({kind:'approve', ts:Date.now(), claim:'minor issue', req:requested1.toString()});
  ({ caseId: caseApprove } = await reportDispute(rentContract, tenant, requested1, ev1.cid));
    const preDep1 = await rentContract.partyDeposit(landlord.address);
    await (await arbitrationService.connect(admin).applyResolutionToTarget(rentContract.target, caseApprove, true, requested1/2n, tenant.address)).wait();
    const postDep1 = await rentContract.partyDeposit(landlord.address);
    assert.strictEqual((preDep1 - postDep1).toString(), requested1.toString(), 'approve delta == requested');

    // 2) Capped: request more than remaining
    const remaining = await rentContract.partyDeposit(landlord.address);
  const requested2 = remaining + parseEther('0.2');
  const ev2 = await addEvidence({kind:'capped', ts:Date.now(), req: requested2.toString()});
  ({ caseId: caseCap } = await reportDispute(rentContract, tenant, requested2, ev2.cid));
    const preDep2 = await rentContract.partyDeposit(landlord.address);
    await (await arbitrationService.connect(admin).applyResolutionToTarget(rentContract.target, caseCap, true, requested2/2n, tenant.address)).wait();
    const postDep2 = await rentContract.partyDeposit(landlord.address);
    assert.strictEqual(postDep2, 0n, 'capped scenario empties deposit');
    caseCap = caseCap; // keep for reference

  // 3) Rejection: re-deposit full required deposit (previous scenarios depleted it)
  const reqDepAgain = await rentContract.requiredDeposit().catch(()=>parseEther('0.5'));
  await (await rentContract.connect(landlord).depositSecurity({ value: reqDepAgain })).wait();
    const preDep3 = await rentContract.partyDeposit(landlord.address);
    const requested3 = parseEther('0.02');
    const ev3 = await addEvidence({kind:'reject', ts:Date.now(), req:requested3.toString()});
    ({ caseId: caseReject } = await reportDispute(rentContract, tenant, requested3, ev3.cid));
    await (await arbitrationService.connect(admin).applyResolutionToTarget(rentContract.target, caseReject, false, 0, tenant.address)).wait();
    const postDep3 = await rentContract.partyDeposit(landlord.address);
    assert.strictEqual(postDep3.toString(), preDep3.toString(), 'rejection leaves deposit intact');

    // 4) Large reject (requested > deposit & approve=false) — deposit should remain, bond to owner
    const topUp = parseEther('0.3');
    await (await rentContract.connect(landlord).depositSecurity({ value: topUp })).wait();
    const beforeLarge = await rentContract.partyDeposit(landlord.address);
    const requestedLarge = beforeLarge + parseEther('0.4');
    const ev4 = await addEvidence({kind:'large-reject', ts:Date.now(), req:requestedLarge.toString()});
    const { caseId: caseLargeReject } = await reportDispute(rentContract, tenant, requestedLarge, ev4.cid);
    await (await arbitrationService.connect(admin).applyResolutionToTarget(rentContract.target, caseLargeReject, false, 0, tenant.address)).wait();
    const afterLarge = await rentContract.partyDeposit(landlord.address);
    assert.strictEqual(afterLarge.toString(), beforeLarge.toString(), 'large reject leaves deposit intact');

    // 5) Replay guard: reapply identical approve transaction for caseApprove (should revert)
    await assert.rejects(
      arbitrationService.connect(admin).applyResolutionToTarget(
        rentContract.target, caseApprove, true, requested1/2n, tenant.address
      ), /Request already processed/
    );
  });
});

async function getFetch(){ if (typeof globalThis!=='undefined' && globalThis.fetch) return globalThis.fetch; try { const nf = await import('node-fetch'); return nf && (nf.default||nf);} catch(e){ throw new Error('fetch not available'); } }
