#!/usr/bin/env node
import { readFileSync } from 'fs';
import { keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';

function canonicalize(obj){
  if(obj===null||obj===undefined) return 'null';
  if(typeof obj!=='object') return JSON.stringify(obj);
  if(Array.isArray(obj)) return '['+obj.map(canonicalize).join(',')+']';
  const keys = Object.keys(obj).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalize(obj[k])).join(',')+'}';
}

function usage(){
  console.error('Usage: evidence-verify.js <cid> <expectedCidDigest> [contentJsonPath]');
  process.exit(1);
}

const [,, cid, expected, contentPath, envelopePath] = process.argv;
if(!cid || !expected) usage();
const cidDigest = keccak256(toUtf8Bytes(cid));
if(cidDigest.toLowerCase() !== expected.toLowerCase()) {
  console.error('CID DIGEST MISMATCH:', cidDigest, '!=', expected);
  process.exit(2);
}
let contentDigest = null; let signatureValid = null; let reason = null;
let envelopeObj = null;
if(envelopePath){
  try {
    const raw = readFileSync(envelopePath,'utf8');
    envelopeObj = JSON.parse(raw);
    if(envelopeObj.contentDigest) contentDigest = envelopeObj.contentDigest;
    if(envelopeObj.signature && envelopeObj.contentDigest && envelopeObj.caseId && envelopeObj.uploader){
      const domain = { name:'Evidence', version:'1', chainId: envelopeObj.chainId || 0, verifyingContract: envelopeObj.verifyingContract || '0x0000000000000000000000000000000000000000' };
      const types = { Evidence:[{name:'caseId',type:'uint256'},{name:'uploader',type:'address'},{name:'contentDigest',type:'bytes32'}] };
      try { const recovered = verifyTypedData(domain, types, { caseId: BigInt(envelopeObj.caseId), uploader: envelopeObj.uploader, contentDigest: envelopeObj.contentDigest }, envelopeObj.signature); signatureValid = recovered.toLowerCase() === String(envelopeObj.uploader).toLowerCase(); if(!signatureValid) reason='signature-mismatch'; } catch(e){ signatureValid = false; reason='signature-error'; }
    }
  } catch(e){ console.error('Envelope parse failed:', e.message); }
}
if(contentPath){
  try {
    const raw = readFileSync(contentPath,'utf8');
    let json=null; try { json = JSON.parse(raw); } catch(_) {}
    const canon = json? canonicalize(json): raw;
    const recomputed = keccak256(toUtf8Bytes(canon));
    if(!contentDigest) contentDigest = recomputed;
    else if(contentDigest.toLowerCase() !== recomputed.toLowerCase()) {
      reason = reason || 'contentDigest-mismatch';
    }
  } catch(e){ console.error('Failed reading content file:', e.message); process.exit(3); }
}
console.log(JSON.stringify({ ok:true, cidDigest, contentDigest, signatureValid, reason }, null, 2));
