import { computeMerkleRoot, generateMerkleProof } from './merkleHelper.js';

/**
 * BatchHelper
 * Handles Merkle batch operations for evidence items per caseId.
 */
export const BatchHelper = {
  /**
   * Build Merkle batch for a case
   * @param {Array} evidenceItems - Array of { leaf, ... }
   * @returns {Object} { root, leaves, proofs }
   */
  buildBatch(evidenceItems) {
    const leaves = evidenceItems.map(e => e.leaf);
    const root = computeMerkleRoot(leaves);
    const proofs = leaves.map((leaf, idx) => generateMerkleProof(leaves, idx));
    return { root, leaves, proofs };
  },

  /**
   * Get proof for a specific leaf
   * @param {Array} leaves
   * @param {number} index
   * @returns {Array} proof
   */
  getProof(leaves, index) {
    return generateMerkleProof(leaves, index);
  },

  /**
   * Submit Merkle root to contract
   * @param {Object} contract - Contract instance
   * @param {string|number} caseId
   * @param {string} root
   * @returns {Promise}
   */
  async submitBatchRoot(contract, caseId, root) {
    if (typeof contract.submitBatchRoot !== 'function') throw new Error('Contract missing submitBatchRoot');
    const tx = await contract.submitBatchRoot(caseId, root);
    await tx.wait();
    return tx.hash;
  }
};

/**
 * Example UI integration for proof verification
 *
 * import { BatchHelper } from '../utils/batchHelper';
 *
 * // After batch built:
 * const { root, leaves, proofs } = BatchHelper.buildBatch(evidenceItems);
 * // To verify a leaf:
 * const valid = verifyMerkleProof(leaves[index], proofs[index], root, index);
 */
