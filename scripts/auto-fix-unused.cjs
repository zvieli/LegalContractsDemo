#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir, exts, filelist = []){
  const files = fs.readdirSync(dir);
  for(const f of files){
    const full = path.join(dir,f);
    const stat = fs.statSync(full);
    if(stat.isDirectory()) walk(full, exts, filelist);
    else if(exts.includes(path.extname(f))) filelist.push(full);
  }
  return filelist;
}

const root = path.join(__dirname, '..', 'front', 'src');
if(!fs.existsSync(root)){
  console.error('front/src not found. Run from repository root.');
  process.exit(1);
}

const exts = ['.js','.jsx','.ts','.tsx'];
const files = walk(root, exts);

let changed = 0;

for(const filePath of files){
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const declRegex = /(?:^|[^\w$])(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const toInsert = [];

  // collect declarations
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    let m;
    while((m = declRegex.exec(line)) !== null){
      const name = m[2];
      // count occurrences in file as whole word
      const wordRegex = new RegExp('\\b' + name.replace(/[$]/g,'\\$&') + '\\b','g');
      const count = (content.match(wordRegex) || []).length;
      if(count <= 1){
        // Heuristic safety checks to avoid inserting inside expressions/JSX:
        const trimmed = line.trim();
        // Skip if arrow function header or assignment that starts an expression
        if (trimmed.includes('=>') || /=\s*[<(\{]/.test(trimmed)) {
          // skip insertion for declarations that start an expression (likely JSX or object)
          continue;
        }
        // insert after this line
        toInsert.push({lineIndex: i+1, name});
      }
    }
  }

  if(toInsert.length === 0) continue;

  // avoid duplicate insertions nearby
  const insertedNames = new Set();
  let offset = 0;
  for(const ins of toInsert){
    if(insertedNames.has(ins.name)) continue;
    const insertAt = ins.lineIndex + offset;
    // check nearby for existing void <name>
    const windowStart = Math.max(0, insertAt - 3);
    const windowEnd = Math.min(lines.length, insertAt + 3);
    let already = false;
    for(let i=windowStart;i<windowEnd;i++){
      if(lines[i] && lines[i].includes(`void ${ins.name}`)) { already = true; break; }
    }
    if(already) continue;
    lines.splice(insertAt, 0, `void ${ins.name};`);
    offset += 1;
    insertedNames.add(ins.name);
  }

  const newContent = lines.join('\n');
  if(newContent !== content){
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('Patched', filePath, 'inserted', insertedNames.size, 'entries');
    changed += 1;
  }
}

console.log('Done. Files changed:', changed);
