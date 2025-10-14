// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TemplateRentContract.sol";
import "contracts/MerkleEvidenceManager.sol";

/// @title EnhancedRentContract
/// @notice Extension of TemplateRentContract with Merkle evidence batching support
/// @dev Adds off-chain evidence attestation capabilities while maintaining backward compatibility
contract EnhancedRentContract is TemplateRentContract {
    MerkleEvidenceManager public immutable merkleEvidenceManager;
    
    // Track which batches have been used for evidence in this contract
    mapping(uint256 => bool) public batchUsedForEvidence;
    
    // Enhanced evidence events
    event EvidenceBatchReferenced(
        uint256 indexed caseId,
        uint256 indexed batchId,
        bytes32 indexed merkleRoot,
        address reporter
    );
    
    event BatchEvidenceVerified(
        uint256 indexed caseId,
        uint256 indexed batchId,
        bytes32 indexed cidHash,
        address uploader,
        bytes32 contentDigest
    );

    constructor(
        address _landlord,
        address _tenant,
        uint256 _rentAmount,
        address _priceFeed,
        uint256 _dueDate,
        uint256 _propertyId,
        address _arbitrationService,
        address _merkleEvidenceManager
    ) TemplateRentContract(
        _landlord,
        _tenant,
        _rentAmount,
        _dueDate,
        _priceFeed,
        _propertyId,
        _arbitrationService,
        0, // defaultRequiredDeposit - will be set by factory
        "" // empty initial evidence URI
    ) {
        merkleEvidenceManager = MerkleEvidenceManager(_merkleEvidenceManager);
    }

    /// @notice Submit evidence reference using Merkle batch (gas optimized)
    /// @param caseId The case ID for this evidence
    /// @param batchId The batch ID containing the evidence
    /// @param evidenceItem The specific evidence item to verify
    /// @param merkleProof The Merkle proof for this evidence item
    function submitEvidenceFromBatch(
        uint256 caseId,
        uint256 batchId,
        MerkleEvidenceManager.EvidenceItem calldata evidenceItem,
        bytes32[] calldata merkleProof
    ) external {
        require(evidenceItem.caseId == caseId, "Case ID mismatch");
        require(evidenceItem.uploader == msg.sender, "Only evidence uploader can submit");
        
        // Verify the evidence exists in the specified batch
        bool isValid = merkleEvidenceManager.verifyEvidence(batchId, evidenceItem, merkleProof);
        require(isValid, "Invalid Merkle proof for evidence");
        
        // Get batch info for additional verification
        MerkleEvidenceManager.EvidenceBatch memory batch = merkleEvidenceManager.getBatch(batchId);
        require(batch.merkleRoot != bytes32(0), "Batch does not exist");
        
        // Track that this batch has been used for evidence in this contract
        batchUsedForEvidence[batchId] = true;
        
        // Emit events for tracking
        emit EvidenceBatchReferenced(caseId, batchId, batch.merkleRoot, msg.sender);
        emit BatchEvidenceVerified(
            caseId, 
            batchId, 
            evidenceItem.cidHash, 
            evidenceItem.uploader,
            evidenceItem.contentDigest
        );
        
        // For backward compatibility, also emit the standard evidence event
        emit EvidenceSubmittedDigest(
            caseId,
            evidenceItem.cidHash,
            evidenceItem.contentDigest,
            msg.sender,
            "" // Empty CID string as it's stored off-chain in batch
        );
    }

    /// @notice Check if evidence from a batch has been submitted for a case
    /// @param batchId The batch ID to check
    /// @return True if the batch has been used for evidence in this contract
    function isBatchUsedForEvidence(uint256 batchId) external view returns (bool) {
        return batchUsedForEvidence[batchId];
    }

    /// @notice Get Merkle evidence manager address
    /// @return Address of the Merkle evidence manager
    function getMerkleEvidenceManager() external view returns (address) {
        return address(merkleEvidenceManager);
    }
}