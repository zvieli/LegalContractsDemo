import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

const target = '0xe7ac8bbf';
const candidateDirs = [
  path.resolve(process.cwd(), 'front', 'src', 'utils', 'contracts'),
  path.resolve(process.cwd(), 'src', 'utils', 'contracts'),
  path.resolve(process.cwd(), 'front', 'src', 'utils', 'contracts')
];
let dir = null;
for (const d of candidateDirs) {
  if (fs.existsSync(d)) { dir = d; break; }
}
if (!dir) {
  console.error('No contracts dir found. Tried:', candidateDirs);
  process.exit(1);
}

function walk(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir,f));
}

const files = walk(dir);
let found = false;
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(f,'utf8'));
    const abi = j.abi || [];
    for (const entry of abi) {
      if (entry.type !== 'function') continue;
      const sig = entry.name + '(' + (entry.inputs||[]).map(i=>i.type).join(',') + ')';
      const sel = ethers.id(sig).slice(0,10);
      if (sel === target) {
        console.log('MATCH in', f);
        console.log('  function:', sig);
        found = true;
      }
    }
  } catch (e) {
    // ignore
  }
}
if (!found) console.log('No match found for', target);
