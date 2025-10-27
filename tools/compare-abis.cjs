const fs = require('fs');
const path = require('path');

function readJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function extractSignatures(abi) {
  const funcs = [];
  const evts = [];
  for (const item of abi || []) {
    if (!item || !item.type) continue;
    if (item.type === 'function') {
      const name = item.name || '';
      const inputs = (item.inputs || []).map(i => `${i.type}`);
      funcs.push(`${name}(${inputs.join(',')})`);
    } else if (item.type === 'event') {
      const name = item.name || '';
      const inputs = (item.inputs || []).map(i => `${i.type}`);
      evts.push(`${name}(${inputs.join(',')})`);
    }
  }
  return { funcs: Array.from(new Set(funcs)).sort(), evts: Array.from(new Set(evts)).sort() };
}

function findArtifact(artifactsDir, contractName) {
  const files = [];
  function walk(dir) {
    const names = fs.readdirSync(dir, { withFileTypes: true });
    for (const d of names) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.isFile() && d.name.toLowerCase().endsWith('.json')) files.push(full);
    }
  }
  try { walk(artifactsDir); } catch(e){ return null; }
  const lower = contractName.toLowerCase();
  for (const f of files) {
    const base = path.basename(f, '.json').toLowerCase();
    if (base === lower) return f;
  }
  for (const f of files) {
    const base = path.basename(f, '.json').toLowerCase();
    if (base.includes(lower)) return f;
  }
  return null;
}

function compareAbis(frontAbiPath, artifactPath) {
  const front = readJson(frontAbiPath);
  const art = readJson(artifactPath);
  if (!front || !art) return { ok: false, reason: 'read_failed', front: !!front, artifact: !!art };
  const frontSig = extractSignatures(front.abi || front);
  const artSig = extractSignatures(art.abi || art);
  const fnAdded = frontSig.funcs.filter(x => !artSig.funcs.includes(x));
  const fnRemoved = artSig.funcs.filter(x => !frontSig.funcs.includes(x));
  const evAdded = frontSig.evts.filter(x => !artSig.evts.includes(x));
  const evRemoved = artSig.evts.filter(x => !frontSig.evts.includes(x));
  return {
    ok: fnAdded.length===0 && fnRemoved.length===0 && evAdded.length===0 && evRemoved.length===0,
    diffs: { fnAdded, fnRemoved, evAdded, evRemoved },
    frontCount: { funcs: frontSig.funcs.length, events: frontSig.evts.length },
    artifactCount: { funcs: artSig.funcs.length, events: artSig.evts.length }
  };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const frontDir = path.join(repoRoot, 'front', 'src', 'utils', 'contracts');
  const artifactsDir = path.join(repoRoot, 'artifacts');
  const out = { scanned: [], errors: [] };
  if (!fs.existsSync(frontDir)) {
    console.error('Front contracts dir not found:', frontDir);
    process.exit(2);
  }
  const names = fs.readdirSync(frontDir).filter(f => f.endsWith('.json'));
  for (const n of names) {
    const fullFront = path.join(frontDir, n);
    const frontJson = readJson(fullFront);
    if (!frontJson) continue;
    const maybeAbi = frontJson.abi || (Array.isArray(frontJson) ? frontJson : null);
    if (!maybeAbi) continue;
    const contractName = path.basename(n, '.json');
    const artPath = findArtifact(artifactsDir, contractName);
    if (!artPath) {
      out.scanned.push({ contract: contractName, front: fullFront, artifact: null, ok: false, reason: 'artifact_not_found' });
      continue;
    }
    const res = compareAbis(fullFront, artPath);
    out.scanned.push({ contract: contractName, front: fullFront, artifact: artPath, result: res });
  }
  const outDir = path.join(repoRoot, 'tmp');
  try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir); } catch(e){}
  const outPath = path.join(outDir, 'abi-compare-report.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('ABI compare finished. Report saved to', outPath);
  let total = out.scanned.length; let mismatches = 0; let missing = 0;
  for (const s of out.scanned) {
    if (!s.artifact) missing++;
    else if (!s.result.ok) mismatches++;
  }
  console.log(`Scanned ${total} ABI files. Missing artifacts: ${missing}. Mismatches: ${mismatches}.`);
  if (mismatches>0 || missing>0) {
    console.log('Detailed report available at', outPath);
    process.exit(0);
  }
  process.exit(0);
}

main();
