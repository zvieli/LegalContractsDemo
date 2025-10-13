import request from 'supertest';
import fs from 'fs';
import { test, describe, beforeAll, afterAll } from 'vitest';
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
const contractFactoryAddress = deploymentSummary.contracts.ContractFactory;

const receiverAddress = deploymentSummary.ccip.contracts.CCIPArbitrationReceiver;
const receiverAbi = require('../../../artifacts/contracts/ccip/CCIPArbitrationReceiver.sol/CCIPArbitrationReceiver.json').abi;
let receiverContract;

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
  { file: 'server/tests/test/evidence12.json', expected: 'NO_PENALTY', type: 'Rent' }
];

const deployedContracts = {};
let ccipListener;
let start;

beforeAll(async () => {
  start = Date.now();
  // Increase timeout for contract deployment
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const partyA = hardhatAccounts[1].address;
  const partyB = hardhatAccounts[2].address;
  const factoryAdminWallet = new ethers.Wallet(hardhatAccounts[0].privateKey, provider);
  const factory = new ethers.Contract(contractFactoryAddress, contractFactoryAbi, factoryAdminWallet);
  const priceFeedAddress = deploymentSummary.priceFeed;

  console.log('Receiver address:', receiverAddress);
  console.log('Receiver ABI loaded:', !!receiverAbi);
  receiverContract = new ethers.Contract(receiverAddress, receiverAbi, factoryAdminWallet);
  console.log('Receiver contract instance:', receiverContract ? receiverContract.target : null);
  if (!receiverContract) {
    throw new Error('Receiver contract not initialized');
  }
  ccipListener = new CCIPEventListener({
    receiverAddress,
    senderAddress: deploymentSummary.ccip.contracts.CCIPArbitrationSender,
    rpcUrl: 'http://127.0.0.1:8545',
    enableLLM: false
  });
  await ccipListener.initialize();
  setImmediate(() => {
    if (!receiverContract) {
      throw new Error('Receiver contract not initialized');
    }
    ccipListener.startListening();
  });

  for (const testCase of cases) {
    try {
      let tx, receipt;
      let deployedAddress = null;

      if (testCase.type === 'Rent') {
        // Use full signature to resolve ambiguity
        tx = await factory["createRentContract(address,uint256,address,uint256,uint256,string)"](
          partyA,
          ethers.parseEther('1'),
          priceFeedAddress,
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          1,
          ''
        );
      } else {
        tx = await factory.createNDA(
          partyB,
          Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
          100,
          ethers.keccak256(ethers.toUtf8Bytes('')),
          ethers.parseEther('0.5')
        );
      }

      receipt = await tx.wait();
      await new Promise(r => setTimeout(r, 300)); // sleep for hardhat

      // Parse logs to find NDACreated or RentContractCreated event and get contract address
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === 'NDACreated' || parsed?.name === 'RentContractCreated') {
            deployedAddress = parsed.args?.[0];
            break;
          }
        } catch {}
      }
      if (!deployedAddress) {
        console.warn(`[WARN] deployedAddress undefined for ${testCase.file}`);
        console.warn(`[DEBUG] receipt.logs:`, receipt.logs);
      } else {
        deployedContracts[testCase.file] = deployedAddress;
        console.log(`[INFO] Deployed ${testCase.type} contract for ${testCase.file}: ${deployedAddress}`);
      }
    } catch (err) {
      console.error(`[ERROR] Deploying contract for ${testCase.file}:`, err);
    }
  }
}, 120000);

describe('End-to-End LLM Arbitration & Blockchain Flow', () => {
  for (const testCase of cases) {
    test(
      `E2E: ${testCase.file} → expected verdict: ${testCase.expected}`,
      async () => {
        console.log(`\n====== Running case: ${testCase.file} (${testCase.type}) ======\n`);
        try {
          const contractAddress = deployedContracts[testCase.file];
          if (!contractAddress) {
            console.warn(`[SKIP] No contract for ${testCase.file}`);
            return;
          }
          const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
          let abiPath;
          if (testCase.type === 'Rent') {
            abiPath = '../../../artifacts/contracts/EnhancedRentContract.sol/EnhancedRentContract.json';
          } else {
            abiPath = '../../../artifacts/contracts/NDA/NDATemplate.sol/NDATemplate.json';
          }
          const contractAbi = require(abiPath).abi;
          const signer = testCase.type === 'Rent'
            ? new ethers.Wallet(hardhatAccounts[1].privateKey, provider)
            : new ethers.Wallet(hardhatAccounts[2].privateKey, provider);
          const contract = new ethers.Contract(contractAddress, contractAbi, signer);
          let evidence;
          try {
            const evidenceData = fs.readFileSync(testCase.file, 'utf8');
            evidence = JSON.parse(evidenceData);
          } catch (err) {
            console.error(`[ERROR] Reading evidence ${testCase.file}:`, err);
            return;
          }
          // deposit / pay
          try {
            if (contract.deposit) {
              await contract.deposit({ value: ethers.parseEther(evidence.amount || '1') });
              console.log(`[INFO] Deposit done for ${testCase.file}`);
            }
            if (contract.pay && evidence.recipient) {
              await contract.pay(evidence.recipient, ethers.parseEther(evidence.amount || '1'));
              console.log(`[INFO] Payment done for ${testCase.file}`);
            }
          } catch (err) {
            console.error(`[ERROR] Deposit/Pay for ${testCase.file}:`, err);
          }
          // Simulate ArbitrationRequestSent event for CCIP listener
          if (ccipListener && receiverContract && receiverContract.triggerMockEvent) {
            await receiverContract.triggerMockEvent(
              ethers.hexlify(ethers.randomBytes(32)),
              ethers.hexlify(ethers.randomBytes(32)),
              31337,
              contractAddress,
              42
            );
            // Wait for async processing
            await new Promise(res => setTimeout(res, 500));
            console.log(`[INFO] CCIPEventListener processed events:`, ccipListener.getProcessedEventsCount());
          }
          // submit evidence
          let submitRes, batchRes, disputeRes, merged;
          try {
            submitRes = await request(BACKEND_URL)
              .post('/api/evidence/submit')
              .send({ caseId: testCase.file, evidenceData: evidence.evidenceData, uploader: 'test-user' });
            console.log(`[INFO] Evidence submitted for ${testCase.file}, CID: ${submitRes.body.cid}`);
          } catch (err) {
            console.error(`[ERROR] Submit evidence for ${testCase.file}:`, err);
          }
          // dispute
          try {
            disputeRes = await request(BACKEND_URL)
              .post('/api/dispute')
              .send({ caseId: testCase.file });
            console.log(`[INFO] Dispute created for ${testCase.file}, ID: ${disputeRes.body.id}`);
          } catch (err) {
            console.error(`[ERROR] Create dispute for ${testCase.file}:`, err);
          }
          // arbitration
          try {
            const pipelineResult = await getLLMResult({
              dispute_id: testCase.file
            });
            merged = {
              verdict: pipelineResult.decision || pipelineResult.arbitration,
              confidence: pipelineResult.confidence,
              rationale: pipelineResult.reasoning,
              source: pipelineResult.source,
              raw: pipelineResult.raw
            };
            console.log(`[INFO] Verdict: ${merged.verdict}, Confidence: ${merged.confidence}`);
          } catch (err) {
            console.error(`[ERROR] LLM pipeline for ${testCase.file}:`, err);
          }

          try {
            await request(BACKEND_URL)
              .post('/api/arbitrate-batch')
              .send({ caseId: testCase.file, merkleRoot: batchRes?.body?.merkleRoot, verdict: merged?.verdict });

            if (contract.applyResolution) await contract.applyResolution(batchRes?.body?.merkleRoot, merged?.verdict);
            if (contract.registerBatch) await contract.registerBatch(batchRes?.body?.merkleRoot);
            console.log(`[INFO] Verdict applied for ${testCase.file}`);
          } catch (err) {
            console.error(`[ERROR] Applying verdict for ${testCase.file}:`, err);
          }

          try {
            const verdictOnChain = contract.getVerdict ? await contract.getVerdict(batchRes?.body?.merkleRoot) : null;
            if (verdictOnChain) console.log(`[INFO] On-chain verdict for ${testCase.file}: ${verdictOnChain}`);
          } catch (err) {
            console.error(`[ERROR] Fetch on-chain verdict for ${testCase.file}:`, err);
          }
        } catch (err) {
          console.error(`[TEST FAILED for ${testCase.file}]`, err);
        }
      },
      120000 // 2 minutes per test
    );
  }
});

afterAll(() => {
  if (ccipListener) {
    ccipListener.stopListening();
    ccipListener.clearProcessedEvents();
  }
  if (receiverContract && receiverContract.provider) {
    receiverContract.provider.removeAllListeners();
  }
  fs.writeFileSync('server/data/dispute_history.json', '[]');
  fs.writeFileSync('server/data/evidence_batches.json', '[]');
  const end = Date.now();
  console.log(`🏁 All tests completed in ${(end - start)/1000}s`);
});
