// This script scans the contracts ABI directory and generates abisIndex.json for dynamic frontend loading
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const abisDir = path.join(__dirname, 'contracts');
const outFile = path.join(__dirname, 'abisIndex.json');

const files = fs.readdirSync(abisDir)
  .filter(f => f.endsWith('.json'));

const abisIndex = {};
for (const file of files) {
  const contractName = file.replace('.json', '');
  abisIndex[contractName] = `/utils/contracts/${file}`;
}

fs.writeFileSync(outFile, JSON.stringify(abisIndex, null, 2));
console.log('abisIndex.json generated:', outFile);
