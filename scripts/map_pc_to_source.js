import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function disassemble(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const bytes = Buffer.from(hex, 'hex');
  const res = [];
  const OP = JSON.parse(fs.readFileSync(path.join(__dirname,'evm_opcodes.json'),'utf8'));
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    const code = b;
    let name = OP[code] ? OP[code].name : 'UNKNOWN';
    let push = 0;
    if (code >= 0x60 && code <= 0x7f) push = code - 0x5f;
    const size = 1 + push;
    const pushData = push ? bytes.slice(i+1, i+1+push).toString('hex') : null;
    res.push({ offset: i, opcode: name, bytes: bytes.slice(i, i+size).toString('hex'), size, pushData });
    i += size;
  }
  return res;
}

function mapPcToSource(buildInfoPath, contractPath, contractName, pcList) {
  const j = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  const inputSources = Object.keys(j.input.sources || {});
  const contract = j.output.contracts[contractPath][contractName];
  if (!contract) { console.error('Contract not found in build info'); process.exit(1); }
  const deployed = contract.evm.deployedBytecode;
  const bytecode = deployed.object || deployed.bytecode || '';
  const opcodes = disassemble(bytecode);
  const sourceMap = (deployed.sourceMap || '').split(';');
  // Map opcode index -> sourceMap entry: usually one-to-one
  function entryForPc(pc) {
    // find opcode entry covering pc
    const opEntry = opcodes.find(o => (o.offset <= pc && pc < o.offset + o.size));
    const opIndex = opcodes.indexOf(opEntry);
    // If this opcode has an empty sourceMap entry, search nearby opcode indices for the nearest non-empty one.
    let idx = opIndex;
    let sm = sourceMap[idx] || '';
    let searched = 0;
    const maxSearch = 200;
    while ((!sm || sm === '') && searched < maxSearch) {
      // try forward then backward
      const fwd = idx + searched;
      const bwd = idx - searched;
      if (fwd < sourceMap.length && sourceMap[fwd] && sourceMap[fwd] !== '') { idx = fwd; sm = sourceMap[fwd]; break; }
      if (bwd >= 0 && sourceMap[bwd] && sourceMap[bwd] !== '') { idx = bwd; sm = sourceMap[bwd]; break; }
      searched++;
    }
    const parts = (sm || '').split(':');
    const start = parts[0] ? Number(parts[0]) : null;
    const len = parts[1] ? Number(parts[1]) : null;
    const fileIdx = parts[2] ? Number(parts[2]) : null;
    if (fileIdx !== null && fileIdx >= 0 && fileIdx < inputSources.length) {
      const srcPath = inputSources[fileIdx];
      const content = j.input.sources[srcPath].content;
      if (start !== null && len !== null) {
        const snippet = content.slice(start, start + len);
        const before = content.slice(0, start);
        const line = before.split('\n').length;
        return { pc, opcode: opEntry.opcode, offset: opEntry.offset, opIndex, mappedOpIndex: idx, sourcePath: srcPath, start, len, line, snippet };
      }
      return { pc, opcode: opEntry.opcode, offset: opEntry.offset, opIndex, mappedOpIndex: idx, sourcePath: srcPath, start, len };
    }
    return { pc, opcode: opEntry.opcode, offset: opEntry.offset, opIndex, mappedOpIndex: idx, sourceMap: sm };
  }
  const results = pcList.map(p => entryForPc(p));
  return results;
}

// small EVM opcodes map file will be written next to this script if missing
const evmOpPath = path.join(__dirname, 'evm_opcodes.json');
if (!fs.existsSync(evmOpPath)) {
  const table = {};
  const base = {
    0: 'STOP',1:'ADD',2:'MUL',3:'SUB',4:'DIV',5:'SDIV',6:'MOD',7:'SMOD',16:'LT',17:'GT',20:'EQ',
  };
  for (const k of Object.keys(base)) table[k] = { name: base[k] };
  for (let i=1;i<=32;i++) table[0x5f+i] = { name: 'PUSH'+i };
  fs.writeFileSync(evmOpPath, JSON.stringify(table));
}

(async ()=>{
  const buildDir = path.join(process.cwd(), 'artifacts', 'build-info');
  const files = fs.readdirSync(buildDir).map(f=>path.join(buildDir,f));
  // find the build-info that contains ArbitrationService
  let chosen = null;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f,'utf8'));
    if (j.output && j.output.contracts) {
      if (j.output.contracts['contracts/Arbitration/ArbitrationService.sol'] && j.output.contracts['contracts/Arbitration/ArbitrationService.sol'].ArbitrationService) { chosen = f; break; }
    }
  }
  if (!chosen) { console.error('build-info for ArbitrationService not found'); process.exit(1); }
  console.log('Using build-info', chosen);
  const resA = mapPcToSource(chosen, 'contracts/Arbitration/ArbitrationService.sol', 'ArbitrationService', [22]);
  console.log('ArbitrationService mapping for PC 22:');
  console.log(resA[0]);

  // TemplateRentContract build-info location
  let chosen2 = null;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f,'utf8'));
    if (j.output && j.output.contracts) {
      if (j.output.contracts['contracts/Rent/TemplateRentContract.sol'] && j.output.contracts['contracts/Rent/TemplateRentContract.sol'].TemplateRentContract) { chosen2 = f; break; }
    }
  }
  if (!chosen2) { console.error('build-info for TemplateRentContract not found'); process.exit(1); }
  console.log('Using build-info', chosen2);
  const resT = mapPcToSource(chosen2, 'contracts/Rent/TemplateRentContract.sol', 'TemplateRentContract', [887]);
  console.log('TemplateRentContract mapping for PC 887:');
  console.log(resT[0]);
  // Additional nearby mapping search for TemplateRentContract
  const j2 = JSON.parse(fs.readFileSync(chosen2,'utf8'));
  const cont2 = j2.output.contracts['contracts/Rent/TemplateRentContract.sol'].TemplateRentContract;
  const srcMap2 = (cont2.evm.deployedBytecode.sourceMap||'').split(';');
  let idx = resT[0].mappedOpIndex || resT[0].opIndex;
  function findNearestValid(smArr, startIdx) {
    for (let d=0; d<500; d++) {
      const f = startIdx + d;
      if (f < smArr.length && smArr[f] && !smArr[f].startsWith('-1')) return {idx: f, val: smArr[f]};
      const b = startIdx - d;
      if (b >=0 && smArr[b] && !smArr[b].startsWith('-1')) return {idx: b, val: smArr[b]};
    }
    return null;
  }
  const found = findNearestValid(srcMap2, idx);
  if (found) {
    console.log('Nearest non -1 sourceMap for TemplateRent at index', found.idx, '=>', found.val);
    const parts = found.val.split(':');
    const start = parts[0] ? Number(parts[0]) : null;
    const len = parts[1] ? Number(parts[1]) : null;
    if (start !== null && len !== null) {
      const inputSources2 = Object.keys(j2.input.sources || {});
      const fileIdx = parts[2] ? Number(parts[2]) : null;
      if (fileIdx !== null && fileIdx >=0 && fileIdx < inputSources2.length) {
        const srcPath = inputSources2[fileIdx];
        const content = j2.input.sources[srcPath].content;
        const before = content.slice(0,start);
        const line = before.split('\n').length;
        console.log('Nearest mapped to file', srcPath, 'line', line, 'charStart', start, 'len', len);
      }
    }
  } else {
    console.log('No nearby non -1 sourceMap found for TemplateRentContract');
  }
})();
