import { describe, it, expect, beforeAll } from 'vitest';
import { ethers } from 'ethers';

// This test assumes local backend and contracts are running
// and CCIP sender/receiver contracts are deployed and configured

describe('CCIP Arbitration End-to-End', () => {
  let provider: ethers.Provider;
  let signer: ethers.Signer;
  let ccipSender: ethers.Contract;
  let ccipReceiver: ethers.Contract;
  let enhancedRentContract: ethers.Contract;

  beforeAll(async () => {
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    signer = new ethers.Wallet(privateKey, provider);

    // Load deployment summary from frontend utils
    const response = await fetch('http://localhost:5173/utils/contracts/deployment-summary.json');
    const data = await response.json();

    // Minimal ABIs for sender/receiver
    const senderAbi = [
      'function sendArbitrationRequest(bytes32 disputeId, address contractAddress, uint256 caseId, bytes32 evidenceHash, string evidenceURI, uint256 requestedAmount, uint8 payFeesIn) external payable returns (bytes32)',
      'event ArbitrationRequestSent(bytes32 indexed messageId, bytes32 indexed disputeId, address indexed contractAddress, uint256 caseId)'
    ];
    const receiverAbi = [
      'function getDecision(bytes32 messageId) external view returns (tuple(bytes32 disputeId, bool approved, uint256 appliedAmount, address beneficiary, string rationale, bytes32 oracleId, uint256 timestamp))',
      'event ArbitrationDecisionReceived(bytes32 indexed messageId, bytes32 indexed disputeId, uint64 indexed sourceChainSelector, bool approved, uint256 appliedAmount, address beneficiary, string rationale, bytes32 oracleId, uint256 timestamp)'
    ];
    const rentAbi = [
      'function reportBreach() external',
      'function getDisputeStatus() external view returns (uint8)'
    ];

    // Use correct addresses from deployment summary
    const senderAddress = data.ccip?.contracts?.CCIPArbitrationSender;
    const receiverAddress = data.ccip?.contracts?.CCIPArbitrationReceiver;
    const rentAddress = data.contracts?.EnhancedRentContract;

    if (!senderAddress || !receiverAddress || !rentAddress) {
      throw new Error('Missing contract addresses in deployment-summary.json');
    }

    ccipSender = new ethers.Contract(senderAddress, senderAbi, signer);
    ccipReceiver = new ethers.Contract(receiverAddress, receiverAbi, signer);
    enhancedRentContract = new ethers.Contract(rentAddress, rentAbi, signer);
  });

  it('should complete CCIP arbitration flow and verify decision', async () => {
    // 1. Trigger a breach to create a dispute
    const breachTx = await enhancedRentContract.reportBreach();
    await breachTx.wait();

    // 2. Prepare arbitration request data
    const disputeId = ethers.keccak256(ethers.toUtf8Bytes('test-dispute-ccip-e2e'));
    const caseId = 1;
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('test evidence'));
  const evidenceCID = 'helia-cid-test-evidence';
    const requestedAmount = ethers.parseEther('1.0');
    const payFeesIn = 0; // Native

    // 3. Send arbitration request via CCIP sender
    const tx = await ccipSender.sendArbitrationRequest(
      disputeId,
      enhancedRentContract.target,
      caseId,
      evidenceHash,
      evidenceCID,
      requestedAmount,
      payFeesIn,
      { value: ethers.parseEther('0.01') }
    );
    const receipt = await tx.wait();

  // 4. Extract ArbitrationRequestSent event
    const arbitrationEvent = ccipSender.interface.getEvent('ArbitrationRequestSent');
    const topicHash = arbitrationEvent ? arbitrationEvent.topicHash : undefined;
    const event = receipt.logs && Array.isArray(receipt.logs) && topicHash
      ? receipt.logs.find((l: any) => l && l.topics && l.topics[0] === topicHash)
      : undefined;
    expect(event).toBeTruthy();
    const messageId = event && event.topics ? event.topics[1] : undefined;
    expect(messageId).toBeTruthy();

    // 5. Wait for backend/LLM/CCIP to process and emit ArbitrationDecisionReceived
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 6. Query receiver contract for decision
    const decision = await ccipReceiver.getDecision(messageId);
    expect(decision).toHaveProperty('disputeId');
    expect(decision).toHaveProperty('approved');
    expect(decision).toHaveProperty('appliedAmount');
    expect(decision).toHaveProperty('beneficiary');
    expect(decision).toHaveProperty('rationale');
    expect(decision).toHaveProperty('oracleId');
    expect(decision).toHaveProperty('timestamp');

    // 7. Log decision for manual verification
    console.log('CCIP Arbitration Decision:', decision);
  });
});
