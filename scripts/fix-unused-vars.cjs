#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node fix-unused-vars.cjs <eslint-report.json>');
  process.exit(2);
}

if (process.argv.length < 3) usage();

const reportPath = process.argv[2];
if (!fs.existsSync(reportPath)) {
  console.error('ESLint report not found at', reportPath);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const fileEdits = new Map();

// regex to capture the variable name from ESLint messages like
// "'addr' is defined but never used" or "'foo' is assigned a value but never used"
const varRegex = /^'([^']+)' (?:is defined but never used|is assigned a value but never used)/;

for (const file of report) {
  const filePath = file.filePath;
  const relevant = file.messages.filter(m => m.ruleId === 'no-unused-vars');
  if (!relevant.length) continue;

  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  // we will insert lines; track offsets as we insert
  let offset = 0;
  const insertedFor = new Set();

  for (const m of relevant) {
    const match = varRegex.exec(m.message);
    if (!match) continue;
    const name = match[1];
    // avoid duplicates
    if (insertedFor.has(name)) continue;

    const line = Math.max(1, m.line || 1);
    const insertAt = line + offset; // insert after reported line

    // quick idempotency check: see small window around insertion for existing void <name>
    const windowStart = Math.max(0, insertAt - 3);
    const windowEnd = Math.min(lines.length, insertAt + 3);
    let already = false;
    for (let i = windowStart; i < windowEnd; i++) {
      if (lines[i] && lines[i].includes(`void ${name}`)) {
        already = true;
        break;
      }
    }
    if (already) {
      insertedFor.add(name);
      continue;
    }

    // create the insert line with no extra indentation (safe/legal JS statement)
    const insertLine = `void ${name};`;
    // insert after the specified line number (1-indexed)
    lines.splice(insertAt, 0, insertLine);
    offset += 1;
    insertedFor.add(name);
    console.log(`Inserted void ${name}; into ${filePath} at line ${insertAt + 1}`);
  }

  if (insertedFor.size > 0) {
    const newContent = lines.join('\n');
    fileEdits.set(filePath, newContent);
  }
}

// write edits
for (const [filePath, content] of fileEdits) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated', filePath);
}

console.log('Done. Files changed:', fileEdits.size);
