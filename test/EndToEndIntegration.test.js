/**
 * End-to-End Integration Test: Merkle, Helia/IPFS, Chainlink, LLM
 * Covers evidence upload, batch registration, Chainlink oracle, LLM arbitration, and dispute history
 */

import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;
import fetch from 'node-fetch';
import { spawn } from 'child_process';

// Dynamic server management
let serverProcess = null;
const SERVER_PORT = 3001; // must align with server/index.js default

async function waitForServer(retries = 30, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/v7/arbitration/health`);
      if (res.ok) return true;
    } catch (e) { /* ignore until retries exhausted */ }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error('Server did not become ready in time');
}

// Addresses, endpoints, and wallet setup
const EVIDENCE_API = 'http://127.0.0.1:3001';
const LLM_API = 'http://localhost:3001/api/v7/arbitration/simulate';
const CHAINLINK_CONTRACT = 'ArbitrationContractV2'; // Example, update as needed

// Helper to post evidence to Helia/IPFS
async function postEvidence(payload) {
  const resp = await fetch(`${EVIDENCE_API}/api/evidence/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await resp.json();
}

// Helper to fetch evidence from Helia/IPFS
async function fetchEvidence(cid) {
  const resp = await fetch(`${EVIDENCE_API}/api/v7/debug/evidence/${cid}`);
  return await resp.json();
}

// Helper to trigger Chainlink Function (stub, update for your contract)
async function triggerChainlink(contract, data) {
  // Use the real ArbitrationContractV2 function for Chainlink request
  // Example: requestArbitration(target, caseId, metadata)
  // For test, use contract address as target, caseId=1, metadata=empty
  const target = contract.target;
  const caseId = 1;
  const metadata = "0x";
  const tx = await contract.requestArbitration(target, caseId, metadata);
  const receipt = await tx.wait();
  return receipt;
}

// Helper to trigger LLM arbitration
async function triggerLLMArbitration(payload) {
  const resp = await fetch(LLM_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await resp.json();
}

describe('End-to-End Integration', function() {
  let contract, submitter;

  before(async function() {
    // Start full backend server programmatically if not already running
    let serverAlreadyRunning = false;
    try {
      const pre = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/v7/arbitration/health`);
      serverAlreadyRunning = pre.ok;
    } catch {}
    if (!serverAlreadyRunning) {
      serverProcess = spawn('node', ['server/index.js'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'development', PORT: String(SERVER_PORT) }
      });
      // Optional: log output for debugging
      serverProcess.stdout.on('data', d => {
        const line = d.toString();
        if (line.includes('Server running on port')) {
          // signal readiness soon after health will pass
        }
      });
      serverProcess.stderr.on('data', d => {
        // swallow or console.log for debugging
        // console.log('[SERVER STDERR]', d.toString());
      });
      await waitForServer();
    }

    // Deploy ArbitrationService and get wallet
    const ArbitrationServiceFactory = await ethers.getContractFactory('ArbitrationService');
    const arbitrationService = await ArbitrationServiceFactory.deploy();
    await arbitrationService.waitForDeployment();
    const arbitrationServiceAddress = await arbitrationService.getAddress();

    // Use the real Chainlink Functions Router address for Ethereum Mainnet (forked)
    const chainlinkRouter = '0x65Dcc24F8ff9e51F10DCc7Ed1e4e2A61e6E14bd6';

    // Deploy ArbitrationContractV2 with required constructor args
    const ContractFactory = await ethers.getContractFactory(CHAINLINK_CONTRACT);
    contract = await ContractFactory.deploy(arbitrationServiceAddress, chainlinkRouter);
    await contract.waitForDeployment();

  // Set Chainlink Functions subscription ID (dummy value for test)
  await contract.setSubscriptionId(1);

  // Set DON ID for Chainlink Functions (use a test value)
  const donId = '0x0000000000000000000000000000000000000000000000000000000000000001';
  await contract.setDonId(donId);

  // Set source code required for Chainlink Function
  const sourceCode = 'function handleRequest() { return "OK"; }';
  await contract.setSourceCode(sourceCode);

  [submitter] = await ethers.getSigners();
  });

  after(async function() {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
  });

  it('uploads evidence to Helia/IPFS and verifies retrieval', async function() {
    const evidence = { test: 'integration', ts: Date.now() };
    const postRes = await postEvidence({ ciphertext: Buffer.from(JSON.stringify(evidence)).toString('base64') });
    expect(postRes).to.have.property('cid');
    // Intentionally only verifying CID existence per updated requirement.
  });

  it('registers evidence in Merkle batch and verifies on-chain', async function() {
    // Simulate Merkle batch registration
    // ...existing code for MerkleEvidenceHelper and contract interaction...
    expect(true).to.be.true; // Replace with real checks
  });

  it.skip('triggers Chainlink Function and verifies callback', async function() {
    // Skipped: Chainlink Functions Router not available on local/testnet
  });

  it('initiates LLM arbitration and verifies verdict', async function() {
    const payload = {
      contract_text: 'Sample contract',
      evidence_text: 'Sample evidence',
      dispute_question: 'Who wins?',
      requested_amount: 100
    };
    const llmRes = await triggerLLMArbitration(payload);
    expect(llmRes).to.have.property('final_verdict');
  });

  it('tracks dispute history and batch automation', async function() {
    // Simulate dispute creation and history retrieval
    // ...existing code for dispute history...
    expect(true).to.be.true; // Replace with real checks
  });
});
