#!/usr/bin/env node
// Append review comment to text files in the repository (skips artifacts and node_modules)
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const SKIP_DIRS = new Set(['node_modules', 'artifacts', 'cache', 'logs', '.git', 'dist', 'build', '__pycache__']);
const COMMENT = '\n//waiting for coderabbit review\n';

function isBinary(filePath) {
  const textExt = ['.js', '.ts', '.json', '.md', '.sol', '.txt', '.ps1', '.sh', '.py', '.yml', '.yaml', '.html', '.css', '.scss', '.env', '.cfg', '.ini', '.lock', '.mdx'];
  return !textExt.includes(path.extname(filePath).toLowerCase());
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full);
    } else if (e.isFile()) {
      // skip binary extensions
      if (isBinary(full)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size === 0) continue;
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('//waiting for coderabbit review')) continue;
        fs.appendFileSync(full, COMMENT, 'utf8');
        console.log('Updated', full);
      } catch (err) {
        console.error('Skipping', full, err.message);
      }
    }
  }
}

walk(ROOT);
console.log('Done');
