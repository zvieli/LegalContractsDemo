import * as ethers from 'ethers';

export function computeCidDigest(cid) {
    return cid ? ethers.keccak256(ethers.toUtf8Bytes(cid)) : ethers.ZeroHash;
}
