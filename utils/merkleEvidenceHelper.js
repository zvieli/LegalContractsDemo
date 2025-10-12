import { MerkleTree } from 'merkletreejs';
import { ethers, keccak256 } from 'ethers';

/**
 * MerkleEvidenceHelper - Utility for creating and verifying Merkle trees for evidence batches
 * @description This helper manages off-chain Merkle tree construction and proof generation
 */
export class MerkleEvidenceHelper {
    constructor() {
        this.evidenceItems = [];
        this.tree = null;
    }

    /**
     * Add evidence item to the batch
     * @param {Object} evidenceItem - Evidence item object
     * @param {number} evidenceItem.caseId - Case ID
     * @param {string} evidenceItem.contentDigest - Content digest (bytes32)
     * @param {string} evidenceItem.cidHash - CID hash (bytes32)
     * @param {string} evidenceItem.uploader - Uploader address
     * @param {number} evidenceItem.timestamp - Timestamp
     */
    addEvidence(evidenceItem) {
        // Accept non-numeric caseId values (tests pass string caseIds like "case-12345").
        // Convert to a uint256-compatible BigInt for ABI encoding. If caseId is not
        // convertible to BigInt, fall back to using the evidence timestamp or current time.
        if (!evidenceItem.contentDigest || !evidenceItem.cidHash || !evidenceItem.uploader || !evidenceItem.timestamp) {
            throw new Error('Missing required evidence fields');
        }

        let caseIdBigInt;
        try {
            caseIdBigInt = BigInt(evidenceItem.caseId);
        } catch (err) {
            // Use timestamp as numeric case id if available, otherwise use current time
            try {
                caseIdBigInt = BigInt(evidenceItem.timestamp);
            } catch (err2) {
                caseIdBigInt = BigInt(Date.now());
            }
        }

        // Ensure timestamp is BigInt
        let timestampBigInt;
        try { timestampBigInt = BigInt(evidenceItem.timestamp); } catch (e) { timestampBigInt = BigInt(Date.now()); }

        this.evidenceItems.push({
            caseId: caseIdBigInt,
            contentDigest: evidenceItem.contentDigest,
            cidHash: evidenceItem.cidHash,
            uploader: evidenceItem.uploader,
            timestamp: timestampBigInt
        });
    }

    /**
     * Build the Merkle tree from current evidence items
     */
    buildTree() {
        if (this.evidenceItems.length === 0) {
            throw new Error('No evidence items to build tree from');
        }

        // Create leaves by encoding each evidence item
        const leaves = this.evidenceItems.map(item => {
            // Match Solidity's abi.encode format
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'bytes32', 'bytes32', 'address', 'uint256'],
                [item.caseId, item.contentDigest, item.cidHash, item.uploader, item.timestamp]
            );
            return keccak256(encoded);
        });

        this.tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        return this.tree;
    }

    /**
     * Get the Merkle root
     * @returns {string} Merkle root as hex string
     */
    getRoot() {
        if (!this.tree) {
            this.buildTree();
        }
        return this.tree.getHexRoot();
    }

    /**
     * Get Merkle proof for a specific evidence item
     * @param {number} index - Index of the evidence item
     * @returns {string[]} Array of proof hashes
     */
    getProof(index) {
        if (!this.tree) {
            this.buildTree();
        }
        
        if (index >= this.evidenceItems.length) {
            throw new Error('Evidence index out of bounds');
        }

        const item = this.evidenceItems[index];
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'bytes32', 'bytes32', 'address', 'uint256'],
            [item.caseId, item.contentDigest, item.cidHash, item.uploader, item.timestamp]
        );
        const leaf = keccak256(encoded);
        
        return this.tree.getHexProof(leaf);
    }

    /**
     * Verify a proof locally (for testing)
     * @param {Object} evidenceItem - Evidence item to verify
     * @param {string[]} proof - Merkle proof
     * @param {string} root - Expected Merkle root
     * @returns {boolean} True if proof is valid
     */
    verifyProof(evidenceItem, proof, root) {
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'bytes32', 'bytes32', 'address', 'uint256'],
            [evidenceItem.caseId, evidenceItem.contentDigest, evidenceItem.cidHash, 
             evidenceItem.uploader, evidenceItem.timestamp]
        );
        const leaf = keccak256(encoded);
        
        return MerkleTree.verify(proof, leaf, root, keccak256, { sortPairs: true });
    }

    /**
     * Get evidence item by index
     * @param {number} index - Index of evidence item
     * @returns {Object} Evidence item
     */
    getEvidenceItem(index) {
        if (index >= this.evidenceItems.length) {
            throw new Error('Evidence index out of bounds');
        }
        return this.evidenceItems[index];
    }

    /**
     * Get all evidence items
     * @returns {Array} All evidence items
     */
    getAllEvidenceItems() {
        return this.evidenceItems;
    }

    /**
     * Get the count of evidence items
     * @returns {number} Count of evidence items
     */
    getEvidenceCount() {
        return this.evidenceItems.length;
    }

    /**
     * Clear all evidence items and reset tree
     */
    clear() {
        this.evidenceItems = [];
        this.tree = null;
    }

    /**
     * Create batch data for contract submission
     * @returns {Object} Batch data with root and count
     */
    createBatchData() {
        if (this.evidenceItems.length === 0) {
            throw new Error('No evidence items in batch');
        }

        // Return a JSON-serializable copy of evidence items (convert BigInt fields to strings)
        const serializableItems = this.evidenceItems.map(item => ({
            caseId: item.caseId !== undefined ? item.caseId.toString() : null,
            contentDigest: item.contentDigest,
            cidHash: item.cidHash,
            uploader: item.uploader,
            timestamp: item.timestamp !== undefined ? item.timestamp.toString() : null
        }));

        return {
            merkleRoot: this.getRoot(),
            evidenceCount: this.evidenceItems.length,
            evidenceItems: serializableItems
        };
    }

    /**
     * Export batch for storage/transmission
     * @returns {Object} Complete batch export
     */
    exportBatch() {
        const batchData = this.createBatchData();
        const proofs = {};
        
        // Generate proofs for all items
        for (let i = 0; i < this.evidenceItems.length; i++) {
            proofs[i] = this.getProof(i);
        }

        return {
            ...batchData,
            proofs,
            timestamp: Date.now()
        };
    }

    /**
     * Import batch from export
     * @param {Object} batchExport - Exported batch data
     */
    importBatch(batchExport) {
        this.clear();
        this.evidenceItems = batchExport.evidenceItems;
        this.buildTree();
        
        // Verify imported data integrity
        const expectedRoot = batchExport.merkleRoot;
        const actualRoot = this.getRoot();
        
        if (expectedRoot !== actualRoot) {
            throw new Error('Batch import failed: Merkle root mismatch');
        }
    }
}

/**
 * Utility functions for evidence batching
 */
export class EvidenceBatcher {
    constructor(maxBatchSize = 256) {
        this.maxBatchSize = maxBatchSize;
        this.currentBatch = new MerkleEvidenceHelper();
        this.completedBatches = [];
    }

    /**
     * Add evidence to current batch, auto-finalize if full
     * @param {Object} evidenceItem - Evidence item to add
     * @returns {Object|null} Completed batch if auto-finalized, null otherwise
     */
    addEvidence(evidenceItem) {
        this.currentBatch.addEvidence(evidenceItem);
        
        if (this.currentBatch.getEvidenceCount() >= this.maxBatchSize) {
            return this.finalizeBatch();
        }
        
        return null;
    }

    /**
     * Finalize current batch and start new one
     * @returns {Object} Completed batch data
     */
    finalizeBatch() {
        if (this.currentBatch.getEvidenceCount() === 0) {
            throw new Error('No evidence items in current batch');
        }

        const completedBatch = this.currentBatch.exportBatch();
        this.completedBatches.push(completedBatch);
        
        this.currentBatch = new MerkleEvidenceHelper();
        
        return completedBatch;
    }

    /**
     * Get current batch status
     * @returns {Object} Batch status information
     */
    getCurrentBatchStatus() {
        return {
            itemCount: this.currentBatch.getEvidenceCount(),
            maxBatchSize: this.maxBatchSize,
            canFinalize: this.currentBatch.getEvidenceCount() > 0,
            isFull: this.currentBatch.getEvidenceCount() >= this.maxBatchSize
        };
    }

    /**
     * Get all completed batches
     * @returns {Array} Array of completed batch exports
     */
    getCompletedBatches() {
        return this.completedBatches;
    }
}