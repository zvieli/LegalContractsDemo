/**
 * verifyMerkleProof
 * Verifies a Merkle proof for a leaf and root.
 * @param {string} leaf - The leaf hash
 * @param {Array<string>} proof - Array of sibling hashes
 * @param {string} root - The expected Merkle root
 * @param {number} index - Index of the leaf in the batch
 * @returns {boolean}
 */
export function verifyMerkleProof(leaf, proof, root, index) {
  let hash = leaf;
  let idx = index;
  for (let i = 0; i < proof.length; i++) {
    const sibling = proof[i];
    const ordered = idx % 2 === 0 ? (hash <= sibling ? [hash, sibling] : [sibling, hash])
                                  : (sibling <= hash ? [sibling, hash] : [hash, sibling]);
    hash = keccak256(solidityPacked(['bytes32','bytes32'], ordered));
    idx = Math.floor(idx / 2);
  }
  return hash === root;
}
import { AbiCoder, getAddress, keccak256, solidityPacked } from 'ethers';

// Re-create file (was missing) providing leaf + root helpers for Merkle evidence batching
const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * computeEvidenceLeaf
 * Mirrors Solidity struct MerkleEvidenceManager.EvidenceItem
 * abi.encode(uint256 caseId, bytes32 contentDigest, bytes32 cidHash, address uploader, uint256 timestamp)
 */
export function computeEvidenceLeaf({ caseId = 0n, contentDigest, cidHash, uploader, timestamp }) {
  if (!uploader) throw new Error('computeEvidenceLeaf: uploader required');
  if (!contentDigest || !cidHash) throw new Error('computeEvidenceLeaf: digests required');
  const cId = BigInt(caseId || 0);
  const ts = BigInt(timestamp || 0);
  const addr = getAddress(uploader);
  return keccak256(
    abiCoder.encode(['uint256','bytes32','bytes32','address','uint256'], [cId, contentDigest, cidHash, addr, ts])
  );
}

/**
 * computeMerkleRoot (stable ordering)
 * - Sort pair (lexicographically) before hashing to avoid second-preimage ambiguity.
 * - Duplicate last node if odd length (standard simple Merkle pattern).
 */
export function computeMerkleRoot(leaves) {
  if (!leaves || leaves.length === 0) return null;
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      const ordered = left <= right ? [left, right] : [right, left];
      next.push(keccak256(solidityPacked(['bytes32','bytes32'], ordered)));
    }
    level = next;
  }
  return level[0];
}

/**
 * generateMerkleProof
 * Build a proof array (sibling hashes bottom-up) for leaf at index.
 * Assumes same stable pair ordering as computeMerkleRoot.
 */
export function generateMerkleProof(leaves, index) {
  if (!Array.isArray(leaves) || leaves.length === 0) throw new Error('No leaves');
  if (index < 0 || index >= leaves.length) throw new Error('Index out of range');
  const proof = [];
  let idx = index;
  let level = leaves.slice();
  while (level.length > 1) {
    const isLastOdd = level.length % 2 === 1 && idx === level.length - 1;
    const pairIndex = isLastOdd ? idx : (idx % 2 === 0 ? idx + 1 : idx - 1);
    const sibling = level[pairIndex];
    proof.push(sibling);
    // build next level
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      const ordered = left <= right ? [left, right] : [right, left];
      next.push(keccak256(solidityPacked(['bytes32','bytes32'], ordered)));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}
