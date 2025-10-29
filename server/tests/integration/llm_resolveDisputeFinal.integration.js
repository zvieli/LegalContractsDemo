import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

export default async function run() {
  const hardhat = await import('hardhat');
  const hre = hardhat.default || hardhat;
  const ethers = hre.ethers;

  const deploymentPath = path.join(process.cwd(), 'server', 'config', 'deployment-summary.json');
  if (!fs.existsSync(deploymentPath)) throw new Error('deployment-summary.json not found');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

  const [deployer, other] = await ethers.getSigners();

  const factory = await ethers.getContractAt('ContractFactory', deployment.contracts.ContractFactory, deployer);
  // create EnhancedRent
  const tenant = other.address;
  const rentAmount = ethers.parseUnits('0.01', 'ether');
  const priceFeedAddr = deployment.priceFeed || deployment.contracts.MockV3Aggregator || deployer.address;
  const dueDate = Math.floor(Date.now() / 1000) + 3600;
  const propertyId = 1;

  const tx = await factory.connect(deployer).createEnhancedRentContract(tenant, rentAmount, priceFeedAddr, dueDate, propertyId);
  const rcpt = await tx.wait();
  let enhancedAddr = null;
  for (const l of rcpt.logs) {
    try {
      const parsed = factory.interface.parseLog(l);
      if (parsed && parsed.name === 'EnhancedRentContractCreated') enhancedAddr = parsed.args[0];
    } catch (e) {}
  }
  if (!enhancedAddr) {
    const contracts = await factory.getContractsByCreator(await deployer.getAddress());
    enhancedAddr = contracts[contracts.length - 1];
  }

  const enhanced = await ethers.getContractAt('EnhancedRentContract', enhancedAddr, deployer);
  // create dispute
  const bond = ethers.parseEther('0.001');
  const requestedAmount = ethers.parseUnits('0.0001', 18);
  const txRep = await enhanced.connect(deployer).reportDispute(0, requestedAmount, 'integration-test-evidence', { value: bond });
  await txRep.wait();

  // call server module
  const modPath = path.resolve(process.cwd(), 'server', 'modules', 'llmArbitration.js');
  const url = pathToFileURL(modPath).href;
  const llmMod = await import(url);
  const requestId = 'itest_' + Date.now();
  const llmResult = {
    final_verdict: 'PARTY_A_WINS',
    reimbursement_amount_dai: 0.0001,
    rationale_summary: 'Integration regression test: award to partyA'
  };

  const out = await llmMod.handleLLMResponse(requestId + '_rent', llmResult, enhancedAddr, 0);
  if (!out || !out.resolutionTx || !out.resolutionTx.prepared) throw new Error('handleLLMResponse did not return prepared resolutionTx');
  const prepared = out.resolutionTx.prepared;
  if (prepared.preferredExecute !== 'resolveDisputeFinal') throw new Error('preferredExecute not set to resolveDisputeFinal');
  if (!prepared.resolveCalldata || typeof prepared.resolveCalldata !== 'string') throw new Error('resolveCalldata not attached to prepared payload');

  // Impersonate arbitration service and call target using the supplied calldata to ensure on-chain effect
  const arbitrationAddress = deployment.contracts.ArbitrationService;
  try {
    if (process.env.ALLOW_IMPERSONATION !== 'true') throw new Error('Impersonation disabled (ALLOW_IMPERSONATION != true)');
    await hre.network.provider.request({ method: 'hardhat_impersonateAccount', params: [arbitrationAddress] });
    const arbSigner = await ethers.getSigner(arbitrationAddress);
    const targetAsArb = await ethers.getContractAt('EnhancedRentContract', enhancedAddr, arbSigner);
  const tx2 = await targetAsArb.resolveDisputeFinal(BigInt(prepared.caseId || 0), prepared.approve, BigInt(prepared.amountWei || 0), prepared.beneficiary, prepared.rationale || String(llmResult.rationale_summary || ''), prepared.rationaleDetail || '');
    await tx2.wait();
    // verify
    const dispute = await enhanced.getDispute(0);
    if (!dispute) throw new Error('Could not read dispute after direct resolve');
    if (dispute[4] !== true) throw new Error('Dispute not marked resolved on-chain after direct resolve');
  } finally {
    try { await hre.network.provider.request({ method: 'hardhat_stopImpersonatingAccount', params: [arbitrationAddress] }); } catch (e) {}
  }

  console.log('llm_resolveDisputeFinal.integration: PASS');
}

// run when executed via `npx hardhat run`
run().catch(err => { console.error(err); process.exit(1); });
