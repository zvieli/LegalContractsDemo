import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

const target = '0xe7ac8bbf';
const repoRoot = process.cwd();

function walkDir(dir, out=[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'logs'].includes(e.name)) continue;
      walkDir(full, out);
    } else if (e.isFile() && e.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

const files = walkDir(repoRoot);
let found = false;
for (const f of files) {
  try {
    const raw = fs.readFileSync(f,'utf8');
    // skip huge files? try parse
    const j = JSON.parse(raw);
    const abi = j.abi || j.abi?.length ? j.abi : null;
    if (!abi || !Array.isArray(abi)) continue;
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
    // ignore parse errors
  }
}
if (!found) console.log('No match found for', target);
