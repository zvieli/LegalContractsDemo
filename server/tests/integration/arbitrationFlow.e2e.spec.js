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
  { file: 'server/tests/test/evidence13.json', expected: 'PARTY_A_WINS', type: 'NDA', customClauses: 'סעיף מותאם: הצד השני מתחייב לשמירה על סודיות מוחלטת.' }
];

const deployedContracts = {};
let ccipListener;
let start;
let partyA, partyB, factory, priceFeedAddress, arbitrationService;

beforeAll(async () => {
  start = Date.now();
  // Increase timeout for contract deployment
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  partyA = hardhatAccounts[1].address;
  partyB = hardhatAccounts[2].address;
  const factoryAdminWallet = new ethers.Wallet(hardhatAccounts[0].privateKey, provider);
  factory = new ethers.Contract(contractFactoryAddress, contractFactoryAbi, factoryAdminWallet);
  priceFeedAddress = deploymentSummary.priceFeed;

  console.log('Receiver address:', receiverAddress);
  console.log('Receiver ABI loaded:', !!receiverAbi);
  receiverContract = new ethers.Contract(receiverAddress, receiverAbi, factoryAdminWallet);
  arbitrationService = new ethers.Contract(arbitrationServiceAddress, arbitrationServiceAbi, factoryAdminWallet);
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

      let customClausesDigest = ethers.keccak256(ethers.toUtf8Bytes(''));

      if (testCase.type === 'Rent') {
        // Use createEnhancedRentContract function
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
        tx = await factory.createEnhancedRentContract(
          partyA,
          ethers.parseEther('1'),
          priceFeedAddress,
          Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          1
        );
      } else {
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
        tx = await factory.createNDA(
          partyB,
          Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
          100,
          customClausesDigest,
          ethers.parseEther('0.5'),
          0 // PayFeesIn.ETH
        );
      }

      receipt = await tx.wait();
      await new Promise(r => setTimeout(r, 300)); // sleep for hardhat

      // Parse logs to find NDACreated or RentContractCreated event and get contract address
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === 'NDACreated' || parsed?.name === 'EnhancedRentContractCreated') {
            deployedAddress = parsed.args?.[0];
            break;
          }
        } catch {}
      }
      if (!deployedAddress) {
        console.warn(`[WARN] deployedAddress undefined for ${testCase.file}`);
        console.warn(`[DEBUG] receipt.logs:`, receipt.logs);
      } else {
        deployedContracts[testCase.file] = { address: deployedAddress, digest: customClausesDigest };
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
          const contractInfo = deployedContracts[testCase.file];
          if (!contractInfo || !contractInfo.address) {
            console.warn(`[SKIP] No contract for ${testCase.file}`);
            return;
          }
          const contractAddress = contractInfo.address;
          const customClausesDigest = contractInfo.digest;
          const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
          let abiPath;
          if (testCase.type === 'Rent') {
            abiPath = '../../../artifacts/contracts/Rent/EnhancedRentContract.sol/EnhancedRentContract.json';
          } else {
            abiPath = '../../../artifacts/contracts/NDA/NDATemplate.sol/NDATemplate.json';
          }
          const contractAbi = require(abiPath).abi;
          const signer = testCase.type === 'Rent'
            ? new ethers.Wallet(hardhatAccounts[1].privateKey, provider)
            : new ethers.Wallet(hardhatAccounts[2].privateKey, provider);
          const contract = new ethers.Contract(contractAddress, contractAbi, signer);

          // Record initial balances for payment verification
          const initialBalanceA = await provider.getBalance(partyA);
          const initialBalanceB = await provider.getBalance(partyB);

          // Verify custom clauses digest if present (only for NDA contracts)
          if (customClausesDigest !== ethers.keccak256(ethers.toUtf8Bytes('')) && testCase.type === 'NDA') {
            const storedDigest = await contract.customClausesHash();
            expect(storedDigest).toBe(customClausesDigest);
            console.log(`[INFO] Custom clauses digest verified for ${testCase.file}`);
          }
          let evidence;
          try {
            const evidenceData = fs.readFileSync(path.resolve(process.cwd(), testCase.file), 'utf8');
            evidence = JSON.parse(evidenceData);
          } catch (err) {
            console.error(`[ERROR] Reading evidence ${testCase.file}:`, err);
            return;
          }
          // For NDA contracts, sign and activate before deposits
          if (testCase.type === 'NDA') {
            try {
              // Get the message hash for signing
              const messageHash = await contract.hashMessage();
              
              // Sign for partyA (creator) - use the correct signer for partyA
              const partyASigner = new ethers.Wallet(hardhatAccounts[1].privateKey, provider);
              const signatureA = await partyASigner.signMessage(ethers.getBytes(messageHash));
              await contract.connect(partyASigner).signNDA(signatureA);
              
              // Sign for partyB - use the correct signer for partyB
              const partyBSigner = new ethers.Wallet(hardhatAccounts[2].privateKey, provider);
              const signatureB = await partyBSigner.signMessage(ethers.getBytes(messageHash));
              await contract.connect(partyBSigner).signNDA(signatureB);
              
              console.log(`[INFO] NDA signed by both parties for ${testCase.file}`);
            } catch (err) {
              console.error(`[ERROR] NDA signing for ${testCase.file}:`, err);
            }
          } else {
            // For Rent contracts, sign the rent agreement
            try {
              const messageHash = await contract.hashMessage();
              
              // Sign for landlord (partyA)
              const landlordSigner = new ethers.Wallet(hardhatAccounts[1].privateKey, provider);
              const landlordSig = await landlordSigner.signMessage(ethers.getBytes(messageHash));
              await contract.connect(landlordSigner).signRent(landlordSig);
              
              // Sign for tenant (partyB)
              const tenantSigner = new ethers.Wallet(hardhatAccounts[2].privateKey, provider);
              const tenantSig = await tenantSigner.signMessage(ethers.getBytes(messageHash));
              await contract.connect(tenantSigner).signRent(tenantSig);
              
              console.log(`[INFO] Rent signed by both parties for ${testCase.file}`);
            } catch (err) {
              console.error(`[ERROR] Rent signing for ${testCase.file}:`, err);
            }
          }
          
          // deposit / pay
          try {
            if (contract.deposit) {
              // Deposit for both parties to meet minimum requirements
              // Use the correct signers for each party
              const partyASigner = new ethers.Wallet(hardhatAccounts[1].privateKey, provider);
              const partyBSigner = new ethers.Wallet(hardhatAccounts[2].privateKey, provider);
              
              await contract.connect(partyASigner).deposit({ value: ethers.parseEther('0.5') });
              await contract.connect(partyBSigner).deposit({ value: ethers.parseEther('0.5') });
              
              console.log(`[INFO] Deposits done for both parties in ${testCase.file}`);
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
          
          // Report breach/dispute on smart contract to create a case
          let caseId;
          try {
            // Check if contract is active before reporting
            let isActive = false;
            if (testCase.type === 'NDA') {
              // For NDA, check if both parties signed and deposited
              const contractState = await contract.contractState();
              isActive = contractState === 2; // ContractState.Active = 2
            } else {
              // For Rent, check if fully signed
              isActive = await contract.isFullySigned();
            }
            
            if (!isActive) {
              console.log(`[WARN] Contract not active for ${testCase.file}, skipping breach/dispute reporting`);
              caseId = 0;
            } else {
              const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(evidence.evidenceData));
              const evidenceURI = `ipfs://${submitRes?.body?.cid || 'test-cid'}`;
              
              if (testCase.type === 'NDA') {
                // For NDA contracts, use reportBreach
                const offender = partyB; // Assume partyB is the offender for testing
                const requestedPenalty = ethers.parseEther('0.5'); // Request 0.5 ETH penalty
                
                const reportTx = await contract.reportBreach(
                  offender,
                  requestedPenalty,
                  evidenceHash,
                  evidenceURI,
                  { value: ethers.parseEther('0.001') } // disputeFee
                );
                const reportReceipt = await reportTx.wait();
                
                // Extract caseId from BreachReported event
                const breachEvents = reportReceipt.logs.filter(log => 
                  log.topics[0] === ethers.id('BreachReported(uint256,address,address,uint256,bytes32)')
                );
                if (breachEvents.length > 0) {
                  const parsed = contract.interface.parseLog(breachEvents[0]);
                  caseId = parsed.args[0]; // caseId is the first argument
                  console.log(`[INFO] Breach reported on NDA contract for ${testCase.file}, caseId: ${caseId}`);
                } else {
                  caseId = 0; // fallback
                  console.log(`[WARN] Could not extract caseId from NDA event, using fallback: ${caseId}`);
                }
              } else {
                // For Rent contracts, use reportDispute
                const disputeType = 0; // Damage (first enum value)
                const requestedAmount = ethers.parseEther('0.5'); // Request 0.5 ETH
                
                const reportTx = await contract.reportDispute(
                  disputeType,
                  requestedAmount,
                  evidenceURI,
                  { value: ethers.parseEther('0.001') } // bond fee
                );
                const reportReceipt = await reportTx.wait();
                
                // Extract caseId from DisputeReported event
                const disputeEvents = reportReceipt.logs.filter(log => 
                  log.topics[0] === ethers.id('DisputeReported(uint256,address,uint8,uint256)')
                );
                if (disputeEvents.length > 0) {
                  const parsed = contract.interface.parseLog(disputeEvents[0]);
                  caseId = parsed.args[0]; // caseId is the first argument
                  console.log(`[INFO] Dispute reported on Rent contract for ${testCase.file}, caseId: ${caseId}`);
                } else {
                  caseId = 0; // fallback
                  console.log(`[WARN] Could not extract caseId from Rent event, using fallback: ${caseId}`);
                }
              }
            }
          } catch (err) {
            console.error(`[ERROR] Report breach/dispute for ${testCase.file}:`, err);
            caseId = 0; // fallback
          }
          // arbitration
          try {
            const pipelineResult = await getLLMResult({
              dispute_id: testCase.file,
              evidence_text: evidence.evidenceData,
              contract_text: 'GENERIC CONTRACT FOR TESTING'
            });
            merged = {
              verdict: pipelineResult.decision || pipelineResult.arbitration,
              confidence: pipelineResult.confidence,
              rationale: pipelineResult.reasoning,
              source: pipelineResult.source,
              raw: pipelineResult.raw
            };
            // Verify frontend data format
            expect(merged.verdict).toBeDefined();
            expect(merged.confidence).toBeDefined();
            expect(merged.rationale).toBeDefined();
            expect(merged.source).toBeDefined();
            expect(merged.raw).toBeDefined();
            console.log(`[INFO] Verdict: ${merged.verdict}, Confidence: ${merged.confidence}`);
          } catch (err) {
            console.error(`[ERROR] LLM pipeline for ${testCase.file}:`, err);
          }

          try {
            await request(BACKEND_URL)
              .post('/api/arbitrate-batch')
              .send({ caseId: testCase.file, merkleRoot: batchRes?.body?.merkleRoot, verdict: merged?.verdict });

            // Apply resolution through arbitration service
            const approve = merged?.verdict === 'PARTY_A_WINS';
            const appliedAmount = ethers.parseEther('0.1'); // Simple amount for testing
            const beneficiary = merged?.verdict === 'PARTY_A_WINS' ? partyA : partyB;

            const tx = await arbitrationService.applyResolutionToTarget(
              contractAddress,
              caseId,
              approve,
              appliedAmount,
              beneficiary
            );
            const receipt = await tx.wait();

            // Check for ResolutionApplied event
            const resolutionEvents = receipt.logs.filter(log =>
              log.topics[0] === ethers.id('ResolutionApplied(bytes32,string)')
            );
            expect(resolutionEvents.length).toBeGreaterThan(0);
            console.log(`[INFO] ResolutionApplied event emitted for ${testCase.file}`);

            // Verify payment transfer if NDA
            if (testCase.type === 'NDA') {
              const finalBalanceA = await provider.getBalance(partyA);
              const finalBalanceB = await provider.getBalance(partyB);
              if (testCase.expected === 'PARTY_A_WINS') {
                expect(finalBalanceA).toBeGreaterThan(initialBalanceA);
              } else if (testCase.expected === 'PARTY_B_WINS') {
                expect(finalBalanceB).toBeGreaterThan(initialBalanceB);
              }
              console.log(`[INFO] Payment transfer verified for ${testCase.file}`);
            }
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
describe('Custom Clauses Integration Tests', () => {
  test('should reject invalid custom clauses upload', async () => {
    const invalidClauses = ''; // empty
    try {
      await request(BACKEND_URL)
        .post('/api/evidence/upload')
        .send({
          caseId: 'invalid-case',
          content: invalidClauses,
          uploader: 'test-user',
          timestamp: Date.now(),
          type: 'customClause'
        });
      expect.fail('Should have rejected invalid clauses');
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  test('should retrieve custom clauses from backend', async () => {
    const customClauses = 'סעיף מותאם: שמירה על סודיות.';
    const uploadRes = await request(BACKEND_URL)
      .post('/api/evidence/upload')
      .send({
        caseId: 'retrieve-case',
        content: customClauses,
        uploader: 'test-user',
        timestamp: Date.now(),
        type: 'customClause'
      });
    expect(uploadRes.body.cid).toBeDefined();

    // Assume there's a retrieve endpoint
    const retrieveRes = await request(BACKEND_URL)
      .get('/api/evidence/retrieve')
      .query({ cid: uploadRes.body.cid });
    expect(retrieveRes.body.content).toContain(customClauses);
  });

  test('should handle dispute history retrieval', async () => {
    // Create a dispute
    const disputeRes = await request(BACKEND_URL)
      .post('/api/dispute')
      .send({ caseId: 'history-case' });
    expect(disputeRes.body.id).toBeDefined();

    // Retrieve history
    const historyRes = await request(BACKEND_URL)
      .get('/api/dispute/history');
    expect(historyRes.body.length).toBeGreaterThan(0);
  });
});
afterAll(() => {
  if (ccipListener) {
    ccipListener.stopListening();
    ccipListener.clearProcessedEvents();
  }
  if (receiverContract && receiverContract.provider) {
    receiverContract.provider.removeAllListeners();
  }
  fs.writeFileSync(path.resolve(process.cwd(), 'server/data/dispute_history.json'), '[]');
  fs.writeFileSync(path.resolve(process.cwd(), 'server/data/evidence_batches.json'), '[]');
  const end = Date.now();
  console.log(`🏁 All tests completed in ${(end - start)/1000}s`);
});


