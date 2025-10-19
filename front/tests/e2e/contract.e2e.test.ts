import { test, expect } from '@playwright/test';
import { ethers, keccak256 } from 'ethers';
import { MerkleTree } from 'merkletreejs';

test.describe('Contract Logic & Events', () => {
  let provider: ethers.Provider;
  let signer: ethers.Signer;
  let merkleEvidenceManager: ethers.Contract;
  let arbitrationService: ethers.Contract;
  let enhancedRentContract: ethers.Contract;

  test.beforeAll(async () => {
    // Connect to local Hardhat node
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    
    // Use a wallet with known private key for testing (Hardhat default account 0)
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    signer = new ethers.Wallet(privateKey, provider);

    // Load contract ABIs and addresses from deployment summary file
    const response = await fetch('http://localhost:5173/utils/contracts/deployment-summary.json');
    const data = await response.json();

    // If deployment summary is missing or incomplete, skip the suite to avoid confusing runtime errors
    if (!data || !data.contracts || !data.contracts.MerkleEvidenceManager || !data.contracts.ArbitrationService || !data.contracts.EnhancedRentContract) {
      console.warn('Deployment summary missing contract addresses; skipping contract e2e tests');
      test.skip();
      return;
    }

    const merkleAbi = [
      "function submitEvidenceBatch(bytes32[] calldata _leaves, bytes32 _root) external",
      "function verifyProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) external pure returns (bool)",
      "function getEvidenceRoot() external view returns (bytes32)"
    ];

    const arbitrationAbi = [
      "function resolveDispute(uint256 disputeId, string calldata decision) external",
      "event DisputeAppliedCapped(uint256 indexed disputeId, address indexed contractAddress)",
      "event ResolutionApplied(uint256 indexed disputeId, string decision)"
    ];

    const rentAbi = [
      "function reportDispute(uint8,uint256,string) external payable",
      "function getDisputeStatus() external view returns (uint8)",
      "event BreachReported(uint256 indexed caseId, address indexed reporter, address indexed offender, uint256 requestedPenalty, bytes32 evidenceHash)"
    ];

    merkleEvidenceManager = new ethers.Contract(
      data.contracts.MerkleEvidenceManager.address,
      merkleAbi,
      signer
    );

    arbitrationService = new ethers.Contract(
      data.contracts.ArbitrationService.address,
      arbitrationAbi,
      signer
    );

    enhancedRentContract = new ethers.Contract(
      data.contracts.EnhancedRentContract.address,
      rentAbi,
      signer
    );
  });

  test('should verify Merkle proof for evidence batch', async () => {
    // Create test evidence data
    const evidenceItems = [
      'Evidence item 1: Contract breach details',
      'Evidence item 2: Payment records',
      'Evidence item 3: Communication logs'
    ];

    // Create Merkle tree
    const leaves = evidenceItems.map(item => keccak256(ethers.toUtf8Bytes(item)));
    const tree = new MerkleTree(leaves, keccak256);
    const root = tree.getRoot();

    // Submit evidence batch to contract
    const submitTx = await merkleEvidenceManager.submitEvidenceBatch(leaves, root);
    await submitTx.wait();

    // Verify the root was stored
    const storedRoot = await merkleEvidenceManager.getEvidenceRoot();
    expect(storedRoot).toBe(ethers.hexlify(root));

    // Verify individual proofs
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(leaves[i]);
      const proofBytes = proof.map(p => p.data);

      const isValid = await merkleEvidenceManager.verifyProof(proofBytes, root, leaves[i]);
      expect(isValid).toBe(true);
    }
  });

  test('should enforce access control on contract methods', async () => {
    // Create a new signer (non-owner)
    const nonOwner = ethers.Wallet.createRandom().connect(provider);

    // Try to call owner-only method with non-owner account
    const arbitrationWithNonOwner = arbitrationService.connect(nonOwner) as any;

    // This should fail due to access control
    await expect(
      arbitrationWithNonOwner.resolveDispute(1, 'Test decision')
    ).rejects.toThrow();

    // Verify owner can call the method
    const ownerAddress = await signer.getAddress();
    const ownerArbitration = arbitrationService.connect(signer) as any;

    // This should succeed (though dispute may not exist)
    try {
      await ownerArbitration.resolveDispute(999, 'Test decision');
    } catch (error: any) {
      // Expected to fail due to non-existent dispute, not access control
      expect(error.message).toMatch(/dispute.*not.*exist|invalid.*dispute/i);
    }
  });

  test('should emit expected events (DisputeAppliedCapped, ResolutionApplied)', async () => {
    // Listen for events
    const disputeFilter = arbitrationService.filters.DisputeAppliedCapped();
    const resolutionFilter = arbitrationService.filters.ResolutionApplied();

    const disputeEvents: any[] = [];
    const resolutionEvents: any[] = [];

    arbitrationService.on(disputeFilter, (disputeId, contractAddress, event) => {
      disputeEvents.push({ disputeId, contractAddress, event });
    });

    arbitrationService.on(resolutionFilter, (disputeId, decision, event) => {
      resolutionEvents.push({ disputeId, decision, event });
    });

  // Setup: try to fetch disputeFee from contract (bond) and use a reporter that is a signer
  let disputeFee = 0n;
  try { disputeFee = await enhancedRentContract.disputeFee(); } catch (e) { disputeFee = 0n; }

  // Trigger a dispute (reportDispute) with dtype=0, requestedAmount small, and evidenceUri
  const dtype = 0;
  const requestedAmount = ethers.parseEther('0.001');
  const evidenceUri = 'ipfs://test-evidence';
  const breachTx = await enhancedRentContract.reportDispute(dtype, requestedAmount, evidenceUri, { value: disputeFee });
  await breachTx.wait();

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify dispute event was emitted
    expect(disputeEvents.length).toBeGreaterThan(0);
    expect(disputeEvents[0]).toHaveProperty('disputeId');
    expect(disputeEvents[0]).toHaveProperty('contractAddress');

    // Resolve the dispute
  const disputeId = disputeEvents[0].disputeId;
  const resolveTx = await arbitrationService.resolveDispute(disputeId, 'Resolved in favor of landlord');
    await resolveTx.wait();

    // Wait for resolution event
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify resolution event was emitted
    expect(resolutionEvents.length).toBeGreaterThan(0);
    expect(resolutionEvents[0].disputeId).toBe(disputeId);
    expect(resolutionEvents[0].decision).toBe('Resolved in favor of landlord');

    // Clean up event listeners
    arbitrationService.removeAllListeners();
  });

  test('should validate evidence digest and contract state', async () => {
    // Submit evidence via API first
    const evidenceResponse = await fetch('http://localhost:3000/api/evidence/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evidence: 'Test evidence for digest validation',
        disputeId: 'test-digest-123'
      })
    });

    expect(evidenceResponse.ok).toBe(true);
    const evidenceData = await evidenceResponse.json();
    expect(evidenceData).toHaveProperty('success');
    expect(evidenceData).toHaveProperty('digest');

    // Verify digest is stored in contract state
    const storedDigest = await merkleEvidenceManager.getEvidenceRoot();
    expect(storedDigest).toBeTruthy();

    // Verify contract state reflects evidence submission
    const disputeStatus = await enhancedRentContract.getDisputeStatus();
    expect(typeof disputeStatus).toBe('number');
  });
});
