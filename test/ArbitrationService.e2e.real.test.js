// Clean E2E test for ArbitrationService + Rent flow (mainnet fork)
// NOTE: Adjust addresses & functions if contract APIs evolve.

import { expect } from 'chai';
import hre from 'hardhat';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { keccak256, toUtf8Bytes } from 'ethers';
const { ethers, network } = hre;

// Helper: assert factory ABI contains expected createRentContract overload(s)
function assertFactoryCreateRentFragments(iface) {
  const createFragments = iface.fragments.filter(f => f.type === 'function' && f.name === 'createRentContract');
  console.error('Discovered createRentContract fragments:', createFragments.map(f => f.format('full')));
  expect(createFragments.length, 'expected at least one createRentContract fragment in factory ABI').to.be.greaterThan(0);
  // Log all function fragments for deeper debugging
  const allFnSigs = iface.fragments.filter(f => f.type === 'function').map(f => f.format('full'));
  console.error('All factory function fragments:', allFnSigs);
}

describe('ArbitrationService E2E (Mainnet Fork, Real Infra)', function () {
  this.timeout(120000);

  let admin, landlord, tenant;
  let arbitrationService, factory, rentContract;
  let storedCaseId;
  let heliaNode, heliaFs;
  let evidenceCid, evidenceDigest;
  let llmDecision;
  let requestedDisputeAmount; // store requested amount for later assertion

  // constants
  const RENT_AMOUNT = ethers.parseEther('1');
  const REQUIRED_DEPOSIT = ethers.parseEther('0.5');
  const DUE_DATE = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const PROPERTY_ID = 12345;
  // mainnet ETH/USD feed (must exist on fork)
  const CHAINLINK_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';

  before(async () => {
    if (!network.config.forking || !network.config.forking.url) {
      throw new Error('Run on mainnet fork (hardhat network with forking)');
    }
    [admin, landlord, tenant] = await ethers.getSigners();

    console.error('Signers:', {
      admin: await admin.getAddress(),
      landlord: await landlord.getAddress(),
      tenant: await tenant.getAddress()
    });
  // Start in-memory Helia for evidence storage
  heliaNode = await createHelia();
  heliaFs = unixfs(heliaNode);
  console.error('Helia node started (in-memory)');

  // Deploy ArbitrationService
    const ArbSvcF = await ethers.getContractFactory('ArbitrationService');
  arbitrationService = await ArbSvcF.connect(admin).deploy();
  await arbitrationService.waitForDeployment();
    console.error('ArbitrationService deployed at', await arbitrationService.getAddress());

    // Deploy Factory
    const FactoryF = await ethers.getContractFactory('ContractFactory');
  factory = await FactoryF.connect(admin).deploy();
  await factory.waitForDeployment();
  console.error('Factory deployed at', await factory.getAddress());
  await (await arbitrationService.connect(admin).setFactory(await factory.getAddress())).wait();
  console.error('Factory set in ArbitrationService');

    // Configure default arbitration & deposit on factory (if API available)
    // setDefaultArbitrationService(address,uint256)
    if (factory.setDefaultArbitrationService) {
      await (await factory.connect(admin).setDefaultArbitrationService(await arbitrationService.getAddress(), REQUIRED_DEPOSIT)).wait();
    }

    // ABI sanity check
    assertFactoryCreateRentFragments(factory.interface);

    // Debug factory address
    console.error('Factory target before call:', factory.target);
    const factoryAddr = await factory.getAddress();
    console.error('Factory getAddress():', factoryAddr);
    expect(factoryAddr).to.properAddress;

    // Explicit fragment to avoid overload ambiguity (base 4-param overload)
    const createFn = factory.connect(landlord)['createRentContract(address,uint256,address,uint256)'];
    console.error('About to invoke createRentContract with args:', {
      tenant: tenant.address,
      rentAmount: RENT_AMOUNT.toString(),
      priceFeed: CHAINLINK_FEED,
      propertyId: PROPERTY_ID
    });
    const createTx = await createFn(
      tenant.address,
      RENT_AMOUNT,
      CHAINLINK_FEED,
      PROPERTY_ID
    );
    console.error('createRentContract tx sent hash:', createTx.hash);
    const rc = await createTx.wait();
    console.error('createRentContract receipt hash:', rc.hash);
    // Parse logs manually (ethers v6)
    let rentAddr;
    for (const log of rc.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed && parsed.name === 'RentContractCreated') {
          rentAddr = parsed.args.contractAddress || parsed.args[0];
          console.error('Parsed RentContractCreated event args:', parsed.args);
          break;
        }
      } catch (_) { /* ignore non-matching log */ }
    }
    if (!rentAddr) {
      throw new Error('RentContractCreated event not found in logs count=' + rc.logs.length);
    }
    const codeLen = (await ethers.provider.getCode(rentAddr)).length;
    console.error('Deployed rent contract code length:', codeLen, 'at', rentAddr);
    expect(rentAddr, 'resolved rent contract address').to.be.a('string');
    rentContract = await ethers.getContractAt('TemplateRentContract', rentAddr);
  });

  it('records initial state', async () => {
    // Basic sanity: code exists & rentAmount matches
      // Basic sanity: code exists & core immutables match
      const code = await ethers.provider.getCode(rentContract.target);
      expect(code.length).to.be.greaterThan(2);
      expect(await rentContract.landlord()).to.equal(landlord.address);
      expect(await rentContract.tenant()).to.equal(tenant.address);
      expect(await rentContract.rentAmount()).to.equal(RENT_AMOUNT);
  });

  it('both parties sign then landlord deposits security', async () => {
    // Prepare EIP712 domain and types
    const net = await ethers.provider.getNetwork();
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: Number(net.chainId),
      verifyingContract: rentContract.target
    };
    const types = {
      RENT: [
        { name: 'contractAddress', type: 'address' },
        { name: 'landlord', type: 'address' },
        { name: 'tenant', type: 'address' },
        { name: 'rentAmount', type: 'uint256' },
        { name: 'dueDate', type: 'uint256' }
      ]
    };
    // dueDate is 0 in the 4-param creation path
    const value = {
      contractAddress: rentContract.target,
      landlord: landlord.address,
      tenant: tenant.address,
      rentAmount: RENT_AMOUNT,
      dueDate: 0n
    };
    const sigLandlord = await landlord.signTypedData(domain, types, value);
    await (await rentContract.connect(landlord).signRent(sigLandlord)).wait();
    const sigTenant = await tenant.signTypedData(domain, types, value);
    await (await rentContract.connect(tenant).signRent(sigTenant)).wait();
    expect(await rentContract.isFullySigned()).to.equal(true);

    // Now deposit via depositSecurity (enforces onlyFullySigned)
    const payValue = REQUIRED_DEPOSIT;
    await (await rentContract.connect(landlord).depositSecurity({ value: payValue })).wait();
    const bal = await rentContract.partyDeposit(landlord.address);
    expect(bal).to.equal(payValue);
  });

  it('tenant uploads evidence to Helia & reports a dispute with CID', async () => {
    // Build evidence JSON
    const evidencePayload = {
      kind: 'rent-dispute',
      ts: Date.now(),
      claim: 'Minor damage to property, seeking partial deposit release',
      requestedAmountEth: '0.1'
    };
    const bytes = new TextEncoder().encode(JSON.stringify(evidencePayload));
    const cid = await heliaFs.addBytes(bytes);
    evidenceCid = cid.toString();
    evidenceDigest = keccak256(toUtf8Bytes(evidenceCid));
    console.error('Evidence CID:', evidenceCid, 'Digest:', evidenceDigest);

    // Attempt optional submitEvidenceDigest if contract exposes it (backward compatibility)
    try {
      const hasSubmit = rentContract.interface.fragments.some(f => f.type === 'function' && f.name === 'submitEvidenceDigest');
      if (hasSubmit) {
        const txSub = await rentContract.connect(tenant).submitEvidenceDigest(evidenceDigest);
        await txSub.wait();
        console.error('submitEvidenceDigest tx hash:', txSub.hash);
      } else {
        console.error('submitEvidenceDigest not present on TemplateRentContract — skipping digest submit');
      }
    } catch (e) {
      console.error('submitEvidenceDigest attempt failed (ignored):', e.message || e);
    }

    // Use ipfs://CID as evidence URI for reportDispute
  const beforeCount = await ethers.provider.getBalance(rentContract.target);
  const requested = ethers.parseEther('0.1');
  requestedDisputeAmount = requested; // persist for resolution test
    const bond = requested / 2000n + 1n; // slightly above 0.05%
  const reportTx = await rentContract.connect(tenant).reportDispute(0, requested, `ipfs://${evidenceCid}`, { value: bond });
    const r = await reportTx.wait();
    // Parse events manually due to v6
    let caseId;
    for (const log of r.logs) {
      try {
        const parsed = rentContract.interface.parseLog(log);
        if (parsed.name === 'DisputeReported') {
          caseId = parsed.args.caseId || parsed.args[0];
          break;
        }
      } catch (_) {}
    }
    expect(caseId, 'extracted caseId').to.not.be.undefined;
    storedCaseId = Number(caseId);
    const afterCount = await ethers.provider.getBalance(rentContract.target);
    // Bond sits in contract balance until resolution paths move it, so balance increases by bond
    expect(afterCount - beforeCount).to.equal(bond);
  });

  it('LLM (simulated) produces recommendation & admin applies resolution', async function () {
    expect(storedCaseId, 'caseId set from previous test').to.not.be.undefined;
    const caseId = storedCaseId;
    // Simulated LLM integration: in real flow you'd POST to external API (Ollama / GPT endpoint)
    // If LLM_ENDPOINT env var provided, attempt fetch; else deterministic fallback.
    async function getFetch() { if (globalThis.fetch) return globalThis.fetch; return (await import('node-fetch')).default; }
    let rawLLM;
    try {
      if (process.env.LLM_ENDPOINT) {
        const fetch = await getFetch();
        const res = await fetch(process.env.LLM_ENDPOINT, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ cid: evidenceCid, digest: evidenceDigest }) });
        rawLLM = await res.text();
      }
    } catch (e) {
      console.error('External LLM call failed, using fallback:', e.message || e);
    }
    // Fallback heuristic: approve if requested <= 0.2 ETH else reject; award half of requested rounded.
    llmDecision = (() => {
      if (rawLLM) {
        try {
          const parsed = JSON.parse(rawLLM);
          if (typeof parsed.approve === 'boolean' && parsed.appliedAmountWei) return parsed;
        } catch (_) { /* ignore */ }
      }
      const approve = true;
      const appliedAmountWei = (ethers.parseEther('0.1') / 2n); // 0.05 eth
      return { approve, appliedAmountWei: appliedAmountWei.toString(), rationale: 'Heuristic fallback decision', model: rawLLM ? 'remote' : 'fallback-local' };
    })();
    console.error('LLM decision:', llmDecision);

  const approve = llmDecision.approve;
  // NOTE: TemplateRentContract _resolveDisputeFinal ignores supplied appliedAmount parameter
  // and instead applies min(requestedAmount, availableDeposit) when approved.
  // We'll still log the LLM suggestion, but expectation will use requestedDisputeAmount.
  const suggestedApplied = BigInt(llmDecision.appliedAmountWei);
    const beneficiary = tenant.address;

  const preDeposit = await rentContract.partyDeposit(landlord.address);
    const preTenantBal = await ethers.provider.getBalance(tenant.address);

    const appliedParam = suggestedApplied; // parameter passed (not authoritative on-chain)
    const tx = await arbitrationService.connect(admin).applyResolutionToTarget(
      rentContract.target,
      caseId,
      approve,
      appliedParam,
      beneficiary
    );
    const receipt = await tx.wait();
    let evArgs;
    for (const log of receipt.logs) {
      try {
        const parsed = arbitrationService.interface.parseLog(log);
        if (parsed.name === 'ResolutionApplied') { evArgs = parsed.args; break; }
      } catch (_) {}
    }
    expect(evArgs, 'ResolutionApplied event').to.exist;
    expect(evArgs.target).to.equal(rentContract.target);
    expect(Number(evArgs.caseId)).to.equal(caseId);

    // Post-resolution assertions
    const postDeposit = await rentContract.partyDeposit(landlord.address);
  const depositDelta = preDeposit - postDeposit;
  const expectedApplied = requestedDisputeAmount; // contract logic uses requestedAmount when approve=true
  console.error('DepositDelta:', depositDelta.toString(), 'LLM suggested:', suggestedApplied.toString(), 'Expected (requested):', expectedApplied.toString());
  expect(depositDelta).to.equal(expectedApplied <= preDeposit ? expectedApplied : preDeposit);

    // Tenant may have received direct transfer; balance delta should be >= applied - gas variance
    const postTenantBal = await ethers.provider.getBalance(tenant.address);
  const balGain = postTenantBal - preTenantBal;
  console.error('Tenant balance gain (wei):', balGain.toString());
  // Allow some gas variance, expect at least 80% of expectedApplied if direct transfer succeeded
  const lowerBound = expectedApplied * 80n / 100n;
  expect(balGain).to.be.gte(lowerBound);
  });

  it('tenant withdraws funds if any withdrawable balance exists', async () => {
    const withdrawable = await rentContract.withdrawable(tenant.address).catch(()=>0n);
    console.error('Tenant withdrawable before:', withdrawable.toString());
    if (withdrawable > 0n) {
      const tx = await rentContract.connect(tenant).withdrawPayments();
      const rc = await tx.wait();
      console.error('withdrawPayments tx hash:', rc.hash);
      expect(await rentContract.withdrawable(tenant.address)).to.equal(0n);
    } else {
      console.error('No withdrawable funds (direct transfer path) — skipping withdrawal assertion');
    }
  });

  it('handles capped dispute approval (requested > available deposit)', async () => {
    // Remaining landlord deposit after first approved dispute
    const preDeposit = await rentContract.partyDeposit(landlord.address);
    expect(preDeposit).to.be.greaterThan(0n);
    // Request more than available to trigger DisputeAppliedCapped
    const requested = preDeposit + ethers.parseEther('0.2'); // exceed remaining
    const bond = requested / 2000n + 1n;
    const repTx = await rentContract.connect(tenant).reportDispute(0, requested, 'ipfs://dummyCapped', { value: bond });
    const repRc = await repTx.wait();
    let caseId;
    for (const log of repRc.logs) {
      try { const p = rentContract.interface.parseLog(log); if (p.name==='DisputeReported') { caseId = Number(p.args[0]); break; } } catch(_){ }
    }
    expect(caseId).to.be.a('number');
    const txRes = await arbitrationService.connect(admin).applyResolutionToTarget(
      rentContract.target,
      caseId,
      true, // approve
      requested / 2n, // parameter (ignored for cap logic)
      tenant.address
    );
    const rcRes = await txRes.wait();
    let cappedSeen = false;
    for (const log of rcRes.logs) {
      try {
        // Need to parse with rentContract interface (Resolution event emitted there)
        const parsed = rentContract.interface.parseLog(log);
        if (parsed.name === 'DisputeAppliedCapped') { cappedSeen = true; break; }
      } catch(_) {}
    }
    expect(cappedSeen, 'DisputeAppliedCapped event observed').to.equal(true);
    const postDeposit = await rentContract.partyDeposit(landlord.address);
    // Entire remaining deposit should have been applied (capped)
    expect(postDeposit).to.equal(0n);
  });

  it('handles dispute rejection (approve=false) leaving deposit intact', async () => {
    // Replenish landlord deposit to required full amount (0.5 ETH) because depositSecurity enforces minimum
    const REQUIRED_DEPOSIT = ethers.parseEther('0.5');
    await (await rentContract.connect(landlord).depositSecurity({ value: REQUIRED_DEPOSIT })).wait();
    const preDeposit = await rentContract.partyDeposit(landlord.address);
    expect(preDeposit).to.equal(REQUIRED_DEPOSIT);
    const requested = ethers.parseEther('0.02');
    const bond = requested / 2000n + 1n;
    const repTx = await rentContract.connect(tenant).reportDispute(0, requested, 'ipfs://dummyReject', { value: bond });
    const repRc = await repTx.wait();
    let caseId;
    for (const log of repRc.logs) {
      try { const p = rentContract.interface.parseLog(log); if (p.name==='DisputeReported') { caseId = Number(p.args[0]); break; } } catch(_) {}
    }
    expect(caseId).to.be.a('number');
    const txRes = await arbitrationService.connect(admin).applyResolutionToTarget(
      rentContract.target,
      caseId,
      false, // reject
      0,
      tenant.address // beneficiary still required, but funds shouldn't move
    );
    const rcRes = await txRes.wait();
    // Ensure DisputeResolved(approve=false) present and no DisputeAppliedCapped in this resolution
    let resolvedFalse = false; let cappedSeen = false;
    for (const log of rcRes.logs) {
      try {
        const parsedSvc = arbitrationService.interface.parseLog(log);
        if (parsedSvc.name === 'ResolutionApplied') {
          // continue scanning for target events
        }
      } catch(_) {}
      try {
        const parsedTarget = rentContract.interface.parseLog(log);
        if (parsedTarget.name === 'DisputeResolved') {
          if (parsedTarget.args[1] === false) resolvedFalse = true; // args: caseId, approve, applied, beneficiary
        }
        if (parsedTarget.name === 'DisputeAppliedCapped') cappedSeen = true;
      } catch(_) {}
    }
    expect(resolvedFalse, 'DisputeResolved approve=false event').to.equal(true);
    expect(cappedSeen, 'No capped event expected on rejection').to.equal(false);
    const postDeposit = await rentContract.partyDeposit(landlord.address);
    // Deposit should remain unchanged after rejection (bond moved to owner, not deposit)
    expect(postDeposit).to.equal(preDeposit, 'deposit unchanged after rejection');
  });
  it('large rejection leaves deposit & replay guard prevents duplicate resolution', async () => {
    // Top up deposit
    const add = ethers.parseEther('0.4');
    await (await rentContract.connect(landlord).depositSecurity({ value: add })).wait();
    const pre = await rentContract.partyDeposit(landlord.address);
    const requested = pre + ethers.parseEther('0.3'); // bigger than deposit
    const bond = requested/2000n + 1n;
    const repTx = await rentContract.connect(tenant).reportDispute(0, requested, 'ipfs://largeReject', { value: bond });
    const repRc = await repTx.wait();
    let caseId; for (const log of repRc.logs) { try { const p = rentContract.interface.parseLog(log); if (p.name==='DisputeReported'){ caseId = Number(p.args[0]); break; } } catch(_){} }
    expect(caseId).to.be.a('number');
    // First rejection
    await (await arbitrationService.connect(admin).applyResolutionToTarget(rentContract.target, caseId, false, 0, tenant.address)).wait();
    const post = await rentContract.partyDeposit(landlord.address);
    expect(post).to.equal(pre);
    // Replay guard with identical parameters should revert
    await expect(
      arbitrationService.connect(admin).applyResolutionToTarget(rentContract.target, caseId, false, 0, tenant.address)
    ).to.be.revertedWith('Request already processed');
  });
  it('reverts unauthorized resolution', async function () {
    await expect(
      arbitrationService.connect(tenant).applyResolutionToTarget(
    rentContract.target,
        999,
        true,
        0,
        tenant.address
      )
    ).to.be.revertedWith('Only owner or factory');
  });
});
