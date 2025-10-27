import { readFileSync } from 'fs';
import { resolve } from 'path';
import { keccak256, toUtf8Bytes } from 'ethers';

const contractPath = resolve('contracts', 'ContractFactory.sol');
const content = readFileSync(contractPath, 'utf8');
const regex = /error\s+([A-Za-z0-9_]+)\s*(\([^\)]*\))?;/g;
let match;
const results = [];
while ((match = regex.exec(content)) !== null) {
  const name = match[1];
  const args = match[2] || '()';
  const sig = `${name}${args}`;
  const hash = keccak256(toUtf8Bytes(sig));
  const selector = hash.slice(0,10);
  results.push({ name, sig, selector });
}
console.log(JSON.stringify(results, null, 2));
