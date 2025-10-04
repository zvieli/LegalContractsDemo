#!/usr/bin/env node
import { readFileSync } from 'fs';
import { keccak256, toUtf8Bytes } from 'ethers';

function usage(){
  console.error('Usage: evidence-verify.js <cid> <expectedCidDigest> [contentJsonPath]');
  process.exit(1);
}

const [,, cid, expected, contentPath] = process.argv;
if(!cid || !expected) usage();
const cidDigest = keccak256(toUtf8Bytes(cid));
if(cidDigest.toLowerCase() !== expected.toLowerCase()) {
  console.error('CID DIGEST MISMATCH:', cidDigest, '!=', expected);
  process.exit(2);
}
let contentDigest = null;
if(contentPath){
  try {
    const raw = readFileSync(contentPath,'utf8');
    contentDigest = keccak256(toUtf8Bytes(raw));
  } catch(e){ console.error('Failed reading content file:', e.message); process.exit(3); }
}
console.log(JSON.stringify({ ok:true, cidDigest, contentDigest }, null, 2));
