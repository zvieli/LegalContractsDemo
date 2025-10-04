import { readFileSync } from 'fs';
import path from 'path';
import url from 'url';

// Lightweight reimplementation to avoid bundling frontend build in tests
export function canonicalize(obj){
  if(obj===null||obj===undefined) return 'null';
  if(typeof obj!=='object') return JSON.stringify(obj);
  if(Array.isArray(obj)) return '['+obj.map(canonicalize).join(',')+']';
  const keys = Object.keys(obj).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalize(obj[k])).join(',')+'}';
}
import { keccak256, toUtf8Bytes } from 'ethers';
export function computeContentDigest(obj){
  const canon = typeof obj === 'string' ? obj : canonicalize(obj);
  return keccak256(toUtf8Bytes(canon));
}
export function computeCidDigest(cid){
  return keccak256(toUtf8Bytes(String(cid||'')));
}
