import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { test, describe, beforeAll, afterAll, expect } from 'vitest';
import deploymentSummary from '../../../front/src/utils/contracts/deployment-summary.json';
import { getLLMResult } from '../test/test_multi_llm.js';
import { ethers } from 'ethers';
import { CCIPEventListener } from '../../ccip/ccipEventListener.js';

// Hardhat test accounts
const hardhatAccounts = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  }
];

const BACKEND_URL = 'http://localhost:3001';
const contractFactoryAbi = require('../../../artifacts/contracts/ContractFactory.sol/ContractFactory.json').abi;
const enhancedRentContractAbi = require('../../../artifacts/contracts/Rent/EnhancedRentContract.sol/EnhancedRentContract.json').abi;
const arbitrationServiceAbi = require('../../../artifacts/contracts/Arbitration/ArbitrationService.sol/ArbitrationService.json').abi;

const contractFactoryAddress = deploymentSummary.contracts.ContractFactory;
const arbitrationServiceAddress = deploymentSummary.contracts.ArbitrationService;
const receiverAddress = deploymentSummary.ccip.contracts.CCIPArbitrationReceiver;
const receiverAbi = require('../../../artifacts/contracts/Arbitration/ccip/CCIPArbitrationReceiver.sol/CCIPArbitrationReceiver.json').abi;

let receiverContract;
let ccipListener;
let start;
let partyA, partyB, factory, priceFeedAddress, arbitrationService;
const deployedContracts = {};

const cases = [
  { file: 'server/tests/test/evidence1.json', expected: 'PARTY_A_WINS', type: 'NDA' },
  { file: 'server/tests/test/evidence2.json', expected: 'PARTY_B_WINS', type: 'Rent' },
  { file: 'server/tests/test/evidence3.json', expected: 'NO_PENALTY', type: 'NDA' },
  { file: 'server/tests/test/evidence4.json', expected: 'DRAW', type: 'Rent' },
  { file: 'server/tests/test/evidence5.json', expected: 'PARTY_A_WINS', type: 'NDA' },
  { file: 'server/tests/test/evidence6.json', expected: 'NO_PENALTY', type: 'Rent' },
  { file: 'server/tests/test/evidence7.json', expected: 'DRAW', type: 'NDA' },
  { file: 'server/tests/test/evidence8.json', expected: 'PARTY_B_WINS', type: 'Rent' },
  { file: 'server/tests/test/evidence9.json', expected: 'NO_PENALTY', type: 'NDA' },
  { file: 'server/tests/test/evidence10.json', expected: 'NO_PENALTY', type: 'Rent' },
  { file: 'server/tests/test/evidence11.json', expected: 'DRAW', type: 'NDA' },
  { file: 'server/tests/test/evidence12.json', expected: 'NO_PENALTY', type: 'Rent' },
];

beforeAll(async () => {
  start = Date.now();
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  partyA = hardhatAccounts[1].address;
  partyB = hardhatAccounts[2].address;
  const factoryAdminWallet = new ethers.Wallet(hardhatAccounts[0].privateKey, provider);
  factory = new ethers.Contract(contractFactoryAddress, contractFactoryAbi, factoryAdminWallet);
  priceFeedAddress = deploymentSummary.priceFeed;
  receiverContract = new ethers.Contract(receiverAddress, receiverAbi, factoryAdminWallet);
  arbitrationService = new ethers.Contract(arbitrationServiceAddress, arbitrationServiceAbi, factoryAdminWallet);

  if (!receiverContract) throw new Error('Receiver contract not initialized');

  ccipListener = new CCIPEventListener({
    receiverAddress,
    senderAddress: deploymentSummary.ccip.contracts.CCIPArbitrationSender,
    rpcUrl: 'http://127.0.0.1:8545',
    enableLLM: false
  });
  await ccipListener.initialize();
  ccipListener.startListening();

  for (const testCase of cases) {
    let tx, receipt, deployedAddress = null;
    let customClausesDigest = ethers.keccak256(ethers.toUtf8Bytes(''));

    if (testCase.customClauses) {
      const uploadRes = await request(BACKEND_URL)
        .post('/api/evidence/upload')
        .send({
          caseId: testCase.file,
          content: testCase.customClauses,
          uploader: 'test-user',
          timestamp: Date.now(),
          type: 'customClause'
        });
      customClausesDigest = ethers.keccak256(ethers.toUtf8Bytes(uploadRes.body.contentDigest));
    }

    if (testCase.type === 'Rent') {
      tx = await factory.createEnhancedRentContract(
        partyA,
        ethers.parseEther('1'),
        priceFeedAddress,
        Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        1
      );
    } else {
      tx = await factory.createNDA(
        partyB,
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        100,
        customClausesDigest,
        ethers.parseEther('0.5'),
        0
      );
    }

    receipt = await tx.wait();
    await new Promise(r => setTimeout(r, 300));

    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed?.name === 'NDACreated' || parsed?.name === 'EnhancedRentContractCreated') {
          deployedAddress = parsed.args?.[0];
          break;
        }
      } catch {}
    }

    if (!deployedAddress) throw new Error(`Failed to get deployedAddress for ${testCase.file}`);
    deployedContracts[testCase.file] = { address: deployedAddress, digest: customClausesDigest };
  }
}, 120000);

describe('E2E LLM Arbitration & Blockchain Flow', () => {
  for (const testCase of cases) {
    test(`E2E: ${testCase.file} → expected verdict: ${testCase.expected}`, async () => {
      const contractInfo = deployedContracts[testCase.file];
      if (!contractInfo?.address) throw new Error(`No contract deployed for ${testCase.file}`);
      const contractAddress = contractInfo.address;
      const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');

      const abiPath = testCase.type === 'Rent' ?
        '../../../artifacts/contracts/Rent/EnhancedRentContract.sol/EnhancedRentContract.json' :
        '../../../artifacts/contracts/NDA/NDATemplate.sol/NDATemplate.json';

      const contractAbi = require(abiPath).abi;
      const signer = new ethers.Wallet(hardhatAccounts[2].privateKey, provider);
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);
      if (!contract) throw new Error(`Contract instance undefined for ${testCase.file}`);

      const evidenceData = fs.readFileSync(path.resolve(process.cwd(), testCase.file), 'utf8');
      const evidence = JSON.parse(evidenceData);
      if (!evidence?.evidenceData) throw new Error(`Evidence data missing for ${testCase.file}`);

      // Handle both string and array evidenceData formats
      let evidenceText;
      if (typeof evidence.evidenceData === 'string') {
        evidenceText = evidence.evidenceData;
      } else if (Array.isArray(evidence.evidenceData)) {
        // Extract descriptions from evidence objects
        evidenceText = evidence.evidenceData.map(item => item.description || item).join(' ');
      } else {
        evidenceText = String(evidence.evidenceData);
      }

      // LLM pipeline
      const pipelineResult = await getLLMResult({
        dispute_id: testCase.file,
        evidence_text: evidenceText,
        contract_text: 'GENERIC CONTRACT FOR TESTING'
      });
      if (!pipelineResult?.decision) throw new Error(`LLM result missing decision for ${testCase.file}`);

      const merged = {
        verdict: pipelineResult.decision,
        confidence: pipelineResult.confidence,
        rationale: pipelineResult.reasoning,
        source: pipelineResult.source,
        raw: pipelineResult.raw
      };

      // Check all fields are defined
      for (const [key, val] of Object.entries(merged)) {
        if (val === undefined || val === null) throw new Error(`[FAIL] ${key} undefined for ${testCase.file}`);
      }

      expect(merged.verdict).toBeDefined();
      expect(merged.confidence).toBeDefined();
      expect(merged.rationale).toBeDefined();
      expect(merged.source).toBeDefined();
      expect(merged.raw).toBeDefined();
        // בדיקת התאמה בין פסק הדין שהתקבל לבין הצפוי
        expect(merged.verdict).toBe(testCase.expected);
    }, 120000);
  }
});

afterAll(() => {
  if (ccipListener) {
    ccipListener.stopListening();
    ccipListener.clearProcessedEvents();
  }
  if (receiverContract?.provider) {
    receiverContract.provider.removeAllListeners();
  }
  fs.writeFileSync(path.resolve(process.cwd(), 'server/data/dispute_history.json'), '[]');
  fs.writeFileSync(path.resolve(process.cwd(), 'server/data/evidence_batches.json'), '[]');
  const end = Date.now();
  console.log(`🏁 All tests completed in ${(end - start)/1000}s`);
});
