// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MerkleEvidenceManager
/// @notice Off-chain evidence attestation with Merkle proof verification
/// @dev Batches multiple evidence submissions into a single Merkle root on-chain
contract MerkleEvidenceManager is Ownable {
    using ECDSA for bytes32;

    struct EvidenceBatch {
        bytes32 merkleRoot;
        uint256 timestamp;
        uint256 evidenceCount;
        address submitter;
        bool finalized;
    }

    struct EvidenceItem {
        uint256 caseId;
        bytes32 contentDigest;
        bytes32 cidHash;
        address uploader;
        uint256 timestamp;
    }

    // Batch ID => EvidenceBatch
    mapping(uint256 => EvidenceBatch) public batches;
    
    // Merkle root => batch ID (for reverse lookup)
    mapping(bytes32 => uint256) public rootToBatchId;
    
    // Track verified evidence items: keccak256(abi.encode(evidenceItem)) => true
    mapping(bytes32 => bool) public verifiedEvidence;
    
    // Prevent duplicate evidence across batches: cidHash => batch ID
    mapping(bytes32 => uint256) public evidenceInBatch;

    uint256 public nextBatchId = 1;
    uint256 public constant MAX_BATCH_SIZE = 256; // Reasonable limit for Merkle tree depth
    
    event BatchCreated(
        uint256 indexed batchId,
        bytes32 indexed merkleRoot,
        uint256 evidenceCount,
        address indexed submitter
    );
    
    event EvidenceVerified(
        uint256 indexed batchId,
        uint256 indexed caseId,
        bytes32 indexed cidHash,
        address uploader,
        bytes32 contentDigest
    );
    
    event BatchFinalized(uint256 indexed batchId, bytes32 merkleRoot);

    constructor() Ownable(msg.sender) {}

    /// @notice Submit a batch of evidence with Merkle root
    /// @param merkleRoot The Merkle root of all evidence items in this batch
    /// @param evidenceCount Number of evidence items in the batch
    function submitEvidenceBatch(
        bytes32 merkleRoot,
        uint256 evidenceCount
    ) external returns (uint256 batchId) {
        require(merkleRoot != bytes32(0), "Invalid Merkle root");
        require(evidenceCount > 0 && evidenceCount <= MAX_BATCH_SIZE, "Invalid evidence count");
        require(rootToBatchId[merkleRoot] == 0, "Merkle root already used");

        batchId = nextBatchId++;
        
        batches[batchId] = EvidenceBatch({
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            evidenceCount: evidenceCount,
            submitter: msg.sender,
            finalized: false
        });
        
        rootToBatchId[merkleRoot] = batchId;
        
        emit BatchCreated(batchId, merkleRoot, evidenceCount, msg.sender);
    }

    /// @notice Verify that a specific evidence item exists in a batch using Merkle proof
    /// @param batchId The batch ID to verify against
    /// @param evidenceItem The evidence item to verify
    /// @param merkleProof The Merkle proof for this evidence item
    function verifyEvidence(
        uint256 batchId,
        EvidenceItem calldata evidenceItem,
        bytes32[] calldata merkleProof
    ) external returns (bool) {
        EvidenceBatch storage batch = batches[batchId];
        require(batch.merkleRoot != bytes32(0), "Batch does not exist");

        // Compute the leaf hash for this evidence item
        bytes32 leaf = keccak256(abi.encode(evidenceItem));
        
        // Verify the Merkle proof
        bool isValid = MerkleProof.verify(merkleProof, batch.merkleRoot, leaf);
        require(isValid, "Invalid Merkle proof");

        // Check for duplicates across all batches
        bytes32 cidHash = evidenceItem.cidHash;
        if (evidenceInBatch[cidHash] != 0 && evidenceInBatch[cidHash] != batchId) {
            revert("Evidence already exists in different batch");
        }

        // Mark as verified
        evidenceInBatch[cidHash] = batchId;
        verifiedEvidence[leaf] = true;

        emit EvidenceVerified(
            batchId,
            evidenceItem.caseId,
            evidenceItem.cidHash,
            evidenceItem.uploader,
            evidenceItem.contentDigest
        );

        return true;
    }

    /// @notice Finalize a batch (optional, for additional security)
    /// @param batchId The batch to finalize
    function finalizeBatch(uint256 batchId) external {
        EvidenceBatch storage batch = batches[batchId];
        require(batch.merkleRoot != bytes32(0), "Batch does not exist");
        require(batch.submitter == msg.sender || msg.sender == owner(), "Not authorized");
        require(!batch.finalized, "Already finalized");

        batch.finalized = true;
        emit BatchFinalized(batchId, batch.merkleRoot);
    }

    /// @notice Check if evidence item is verified in any batch
    /// @param evidenceItem The evidence item to check
    function isEvidenceVerified(EvidenceItem calldata evidenceItem) external view returns (bool) {
        bytes32 leaf = keccak256(abi.encode(evidenceItem));
        return verifiedEvidence[leaf];
    }

    /// @notice Get batch information
    /// @param batchId The batch ID to query
    function getBatch(uint256 batchId) external view returns (EvidenceBatch memory) {
        return batches[batchId];
    }

    /// @notice Get the batch ID for a given Merkle root
    /// @param merkleRoot The Merkle root to lookup
    function getBatchIdByRoot(bytes32 merkleRoot) external view returns (uint256) {
        return rootToBatchId[merkleRoot];
    }
}