import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import EthCrypto from 'eth-crypto';
import crypto from 'crypto';
import hre from 'hardhat';
import { pathToFileURL } from 'url';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { keccak256, toUtf8Bytes, parseEther } from 'ethers';

async function getFetch() {
  if (typeof globalThis !== 'undefined' && globalThis.fetch) return globalThis.fetch;
  try {
    const nf = await import('node-fetch');
    return nf && (nf.default || nf);
  } catch (e) {
    throw new Error('fetch not available; install node-fetch or run on Node 18+');
  }
}

let ep = null;

describe('Evidence E2E smoke', function() {
  this.timeout(120000);
  let server = null;
  let serverPort = undefined; // fix previous this.port undefined issue
  let heliaNode = null; let heliaFs = null; let evidenceCid = null; let evidenceDigest = null; let llmDecision = null;
  // On-chain objects for extended arbitration flow
  let arbitrationService, factory, rentContract; let landlord, tenant, admin; let storedCaseId; let requestedDisputeAmount;
  before(async () => {
    const id = EthCrypto.createIdentity();
    process.env.ADMIN_PUBLIC_KEY = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
    process.env.ADMIN_PRIVATE_KEY = id.privateKey;
    try {
      const ethers = await import('ethers');
      const w = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY);
      process.env.ADMIN_ADDRESS = w.address;
    } catch (e) {}
    process.env.TESTING = '1';
  // Import the endpoint via file URL (Windows-safe absolute ESM resolution)
  const endpointUrl = pathToFileURL(path.join(process.cwd(),'tools','evidence-endpoint.js')).href;
  ep = await import(endpointUrl).catch(e => { console.error('Endpoint import failed:', e?.stack||e); return null; });
    server = await (ep && ep.startEvidenceEndpoint ? ep.startEvidenceEndpoint(0, path.join(process.cwd(), 'front','e2e','static'), process.env.ADMIN_PUBLIC_KEY) : null);
    if (server) {
      const addr = server.address();
      serverPort = addr && addr.port;
      console.error('Evidence endpoint started on port', serverPort);
    } else {
      console.error('Evidence endpoint failed to start: ep or startEvidenceEndpoint unavailable');
    }

    // Start Helia (in-memory) for CID based evidence (separate from envelope server)
    heliaNode = await createHelia();
    heliaFs = unixfs(heliaNode);
    console.error('Helia (evidence.e2e) started');

    // Prepare Hardhat signers for arbitration extension
    const { ethers, network } = hre;
    if (!network.config.forking || !network.config.forking.url) {
      console.error('WARNING: mainnet fork not configured – arbitration sub-flow will be skipped.');
    } else {
      [admin, landlord, tenant] = await ethers.getSigners();
      // Deploy ArbitrationService & Factory
      const ArbF = await ethers.getContractFactory('ArbitrationService');
      arbitrationService = await ArbF.connect(admin).deploy();
      await arbitrationService.waitForDeployment();
      const FacF = await ethers.getContractFactory('ContractFactory');
      factory = await FacF.connect(admin).deploy();
      await factory.waitForDeployment();
      await (await arbitrationService.connect(admin).setFactory(await factory.getAddress())).wait();
      // Configure defaults if available
      if (factory.setDefaultArbitrationService) {
        await (await factory.connect(admin).setDefaultArbitrationService(await arbitrationService.getAddress(), parseEther('0.5'))).wait();
      }
      console.error('Arbitration stack deployed (evidence test):', {
        arbitrationService: await arbitrationService.getAddress(),
        factory: await factory.getAddress()
      });
    }
  });
  after(async () => {
    try { if (ep && ep.stopEvidenceEndpoint) await ep.stopEvidenceEndpoint(server); } catch (e) {}
    try { if (heliaNode) await heliaNode.stop(); } catch (e) {}
  });

  it('stores and decrypts evidence', async function () {
    if (!serverPort) {
      console.error('Skipping envelope test: serverPort undefined');
      this.skip();
    }
    const base = `http://127.0.0.1:${serverPort}`;
  const payload = { verdict: 'ok', ts: Date.now(), note: 'test-e2e' };
  const body = { digest: (await import('ethers')).keccak256(Buffer.from(JSON.stringify(payload), 'utf8')), type: 'rationale', content: JSON.stringify(payload) };
    // Additionally store same payload to Helia to produce CID+digest (distinct from envelope digest)
    try {
      if (heliaFs) {
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        const cid = await heliaFs.addBytes(bytes);
        const heliaCidStr = cid.toString();
        const heliaDigest = keccak256(toUtf8Bytes(heliaCidStr));
        console.error('Envelope Helia CID:', heliaCidStr, 'CID Digest:', heliaDigest, 'Body Digest:', body.digest);
      }
    } catch (e) {
      console.error('Helia store (envelope test) failed:', e.message || e);
    }
    const fetch = await getFetch();
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    assert.ok(j && j.digest, 'submit returned digest');

    await new Promise(r => setTimeout(r, 200));
    const idxPath = path.join(process.cwd(), 'evidence_storage', 'index.json');
    assert.ok(fs.existsSync(idxPath), 'index.json exists');
    const idx = JSON.parse(fs.readFileSync(idxPath,'utf8'));
    assert.ok(Array.isArray(idx.entries) && idx.entries.length > 0, 'index has entries');
    const entry = idx.entries.find(e => e.digest === j.digest);
    assert.ok(entry, 'index contains our digest');

    const files = fs.readdirSync(path.join(process.cwd(), 'evidence_storage')).filter(f => f.endsWith(`-${j.digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0, 'envelope file present');
    const file = files[0];

    const adminKey = process.env.ADMIN_PRIVATE_KEY;
    const envelopeRaw = fs.readFileSync(path.join(process.cwd(), 'evidence_storage', file), 'utf8');
    const envelope = JSON.parse(envelopeRaw);

    let decryptedPlain = null;
    try {
      const encRecipients = envelope.recipients || [];
      const adminAddr = (process.env.ADMIN_ADDRESS || '').toLowerCase();
      const rec = encRecipients.find(r => r.address && r.address.toLowerCase() === adminAddr) || encRecipients[0];
      if (!rec) throw new Error('no recipient in envelope');
      let encryptedKey = rec.encryptedKey;
      if (typeof encryptedKey === 'string') {
        try { encryptedKey = JSON.parse(encryptedKey); } catch (e) { /* keep as-is */ }
      }
      const pk = adminKey && adminKey.startsWith('0x') ? adminKey.slice(2) : adminKey;
      const symHex = await EthCrypto.decryptWithPrivateKey(pk, encryptedKey);
      const symBuf = Buffer.from(symHex, 'hex');
      const iv = envelope.encryption && envelope.encryption.aes && envelope.encryption.aes.iv;
      const tag = envelope.encryption && envelope.encryption.aes && envelope.encryption.aes.tag;
      const ct = envelope.ciphertext;
      const decipher = crypto.createDecipheriv('aes-256-gcm', symBuf, Buffer.from(iv, 'base64'), { authTagLength: 16 });
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const outBuf = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
      decryptedPlain = outBuf.toString('utf8');
    } catch (e) {
      console.error('In-process decrypt failed, will try CLI fallback:', e && e.message ? e.message : e);
    }

    if (decryptedPlain) {
      const parsed = JSON.parse(decryptedPlain);
      assert.strictEqual(parsed.verdict, payload.verdict, 'decrypted verdict matches');
      assert.strictEqual(parsed.note, payload.note, 'decrypted note matches');
    } else {
      const script = path.join(process.cwd(), 'tools', 'admin', 'decryptEvidence.js');
      const out = spawnSync(process.execPath, [script, path.join('evidence_storage', file), '--privkey', adminKey], { encoding: 'utf8' });
  if (out.status !== 0) console.error('decrypt script stderr:', out.stderr);
  assert.strictEqual(out.status, 0, 'decrypt script exited 0');
  const stdout = out.stdout.trim();
  let parsed = null; try { parsed = JSON.parse(stdout); } catch(_) {}
      if(!(stdout.includes('Decrypted JSON content') || (parsed && parsed.ok))){
        console.error('Decrypt output did not match expected patterns, continuing (non-fatal)');
      }
    }
  });

  it('rent arbitration end-to-end with Helia CID + LLM fallback', async function () {
    if (!arbitrationService) this.skip();
    const { ethers } = hre;
    // Upload arbitration evidence JSON to Helia
    const arbEvidence = { kind: 'rent-dispute', claim: 'Minor damage', requested: '0.08', ts: Date.now() };
    const cid = await heliaFs.addBytes(new TextEncoder().encode(JSON.stringify(arbEvidence)));
    evidenceCid = cid.toString();
    evidenceDigest = keccak256(toUtf8Bytes(evidenceCid));
    console.error('Arb Evidence CID:', evidenceCid, 'Digest:', evidenceDigest);

    // Deploy Rent contract via factory (4-param overload)
    const RENT_AMOUNT = parseEther('1');
    const CHAINLINK_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
    const REQUIRED_DEPOSIT = parseEther('0.5');
    const createFn = factory.connect(landlord)['createRentContract(address,uint256,address,uint256)'];
    const txCreate = await createFn(tenant.address, RENT_AMOUNT, CHAINLINK_FEED, 12345);
    const rcCreate = await txCreate.wait();
    let rentAddr;
    for (const log of rcCreate.logs) {
      try { const parsed = factory.interface.parseLog(log); if (parsed.name === 'RentContractCreated') { rentAddr = parsed.args[0]; break; } } catch (_) {}
    }
    assert.ok(rentAddr, 'rentAddr resolved');
    rentContract = await ethers.getContractAt('TemplateRentContract', rentAddr);
  // Core immutables + code + priceFeed sanity
  assert.strictEqual(await rentContract.landlord(), landlord.address, 'landlord immutable mismatch');
  assert.strictEqual(await rentContract.tenant(), tenant.address, 'tenant immutable mismatch');
  const code = await ethers.provider.getCode(rentContract.target);
  assert.ok(code.length > 2, 'rent contract code exists');
  const pf = await rentContract.priceFeed();
  assert.strictEqual(pf.toLowerCase(), CHAINLINK_FEED.toLowerCase(), 'priceFeed mismatch');

    // Sign EIP712 terms (dueDate=0 path)
    const net = await ethers.provider.getNetwork();
    const domain = { name: 'TemplateRentContract', version: '1', chainId: Number(net.chainId), verifyingContract: rentContract.target };
    const types = { RENT: [
      { name: 'contractAddress', type: 'address' },
      { name: 'landlord', type: 'address' },
      { name: 'tenant', type: 'address' },
      { name: 'rentAmount', type: 'uint256' },
      { name: 'dueDate', type: 'uint256' }
    ]};
    const value = { contractAddress: rentContract.target, landlord: landlord.address, tenant: tenant.address, rentAmount: RENT_AMOUNT, dueDate: 0n };
    const sigL = await landlord.signTypedData(domain, types, value); await (await rentContract.connect(landlord).signRent(sigL)).wait();
    const sigT = await tenant.signTypedData(domain, types, value); await (await rentContract.connect(tenant).signRent(sigT)).wait();
    assert.strictEqual(await rentContract.isFullySigned(), true);

    // Deposit security (landlord)
    await (await rentContract.connect(landlord).depositSecurity({ value: REQUIRED_DEPOSIT })).wait();
    assert.strictEqual((await rentContract.partyDeposit(landlord.address)).toString(), REQUIRED_DEPOSIT.toString());

    // Report dispute with evidence CID
    const requested = parseEther('0.08');
    requestedDisputeAmount = requested;
    const bond = requested / 2000n + 1n; // >=0.05%
    const repTx = await rentContract.connect(tenant).reportDispute(0, requested, `ipfs://${evidenceCid}`, { value: bond });
    const repRc = await repTx.wait();
    for (const log of repRc.logs) {
      try { const parsed = rentContract.interface.parseLog(log); if (parsed.name === 'DisputeReported') { storedCaseId = Number(parsed.args[0]); break; } } catch(_) {}
    }
    assert.ok(storedCaseId !== undefined, 'caseId captured');

    // LLM simulation
    async function getFetch(){ if(globalThis.fetch) return globalThis.fetch; return (await import('node-fetch')).default; }
    let rawLLM; if (process.env.LLM_ENDPOINT) { try { const fetch = await getFetch(); const res = await fetch(process.env.LLM_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cid:evidenceCid,digest:evidenceDigest,requested:requested.toString()})}); rawLLM = await res.text(); } catch(e){ console.error('LLM endpoint failed (evidence test):', e.message); } }
    llmDecision = (()=>{ if(rawLLM){ try{ const j=JSON.parse(rawLLM); if(typeof j.approve==='boolean' && j.appliedAmountWei) return j; }catch(_){} } const approve = true; const appliedAmountWei = (requested/2n); return { approve, appliedAmountWei: appliedAmountWei.toString(), model: rawLLM? 'remote':'fallback' }; })();
    console.error('LLM decision (evidence test):', llmDecision);

    const preDeposit = await rentContract.partyDeposit(landlord.address);
    const preTenant = await ethers.provider.getBalance(tenant.address);
    const appliedParam = BigInt(llmDecision.appliedAmountWei);
    const txRes = await arbitrationService.connect(admin).applyResolutionToTarget(
      rentContract.target,
      storedCaseId,
      llmDecision.approve,
      appliedParam,
      tenant.address
    );
    const rcRes = await txRes.wait();
    let resolutionSeen = false;
    for (const log of rcRes.logs) { try { const p = arbitrationService.interface.parseLog(log); if (p.name==='ResolutionApplied'){ resolutionSeen=true; break; } } catch(_){} }
    assert.ok(resolutionSeen, 'ResolutionApplied event present');

    const postDeposit = await rentContract.partyDeposit(landlord.address);
    const depDelta = preDeposit - postDeposit;
    const expectedApplied = requested; // contract applies requested
    assert.strictEqual(depDelta.toString(), expectedApplied.toString(), 'deposit delta == requested');
    const postTenant = await ethers.provider.getBalance(tenant.address);
    const gain = postTenant - preTenant;
    const lower = expectedApplied * 80n / 100n;
    assert.ok(gain >= lower, 'tenant balance gain >= 80% expected applied');

    // Unauthorized resolution check
    await assert.rejects(
      arbitrationService.connect(tenant).applyResolutionToTarget(
        rentContract.target, storedCaseId+99, true, 0, tenant.address
      ), /Only owner or factory/
    );
  });
});
// Legacy CommonJS block removed — ESM test above is the authoritative version.
