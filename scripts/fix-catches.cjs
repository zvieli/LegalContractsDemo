const fs = require('fs');
const path = require('path');

function walk(dir) {
  const res = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      res.push(...walk(full));
    } else if (/\.jsx?$/.test(name) || /\.tsx?$/.test(name)) {
      res.push(full);
    }
  }
  return res;
}

function processFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  let orig = s;
  // 1) handle catch(<ident>) {  -> insert void <ident>; if not already present
  s = s.replace(/catch\s*\(\s*([A-Za-z_$][\\w$]*)\s*\)\s*\{/g, (m, name) => {
    // If the block already contains 'void name;' immediately after the brace, skip
    const idx = s.indexOf(m);
    const after = s.slice(idx + m.length, idx + m.length + 40);
    if (new RegExp('^\\s*void\\s+' + name + '\\s*;').test(after)) return m;
    return `catch (${name}) { void ${name};`;
  });
  
  // 2) handle parameterless catch {  -> catch (_){ void _; if not already present
  s = s.replace(/catch\s*\{/g, (m, offset) => {
    const after = s.slice(offset + m.length, offset + m.length + 20);
    if (/^\s*void\s+_\s*;/.test(after)) return m;
    return 'catch (_){ void _;';
  });

  if (s !== orig) {
    fs.writeFileSync(file, s, 'utf8');
    return true;
  }
  return false;
}

function main() {
  const root = path.resolve(__dirname, '..', 'front', 'src');
  console.log('Scanning', root);
  const files = walk(root);
  let changed = 0;
  for (const f of files) {
    try {
      const ok = processFile(f);
      if (ok) {
        console.log('Updated', path.relative(process.cwd(), f));
        changed++;
      }
    } catch (e) {
      console.error('Failed', f, e && e.message);
    }
  }
  console.log('Done. Files changed:', changed);
}

main();
