import * as ethers from 'ethers';

// Compute the keccak256 digest for an off-chain evidence payload string.
// Returns `ethers.ZeroHash` when `payload` is falsy.
export function computePayloadDigest(payload) {
    return payload ? ethers.keccak256(ethers.toUtf8Bytes(payload)) : ethers.ZeroHash;
}
