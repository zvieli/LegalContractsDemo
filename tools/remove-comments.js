#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex !== -1 ? args[rootIndex+1] : process.cwd();
const APPLY = args.includes('--apply');

const exts = ['.sol','.js','.ts','.jsx','.tsx','.py','.ps1','.sh','.java','.c','.cpp','.h'];
const ignoreDirs = new Set(['.git','node_modules','artifacts','build-info','cache','logs','test-results','.comment-backups','.gitignore','.github']);

async function walk(dir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const dirent of list) {
    const name = dirent.name;
    if (ignoreDirs.has(name)) continue;
    const full = path.join(dir, name);
    if (dirent.isDirectory()) {
      results = results.concat(await walk(full));
    } else {
      if (exts.includes(path.extname(name))) results.push(full);
    }
  }
  return results;
}

function preservePlaceholders(content) {
  const placeholders = [];
  // preserve shebangs
  content = content.replace(/^#!.*$/m, (m) => {
    const token = `__SHEBANG_${placeholders.length}__`;
    placeholders.push(m);
    return token;
  });

  // preserve SPDX lines (single-line or block style)
  // match // SPDX-License-Identifier: ...
  content = content.replace(/(^|\n)\s*\/\/\s*SPDX-License-Identifier:\s*.*(?=\n|$)/g, (m) => {
    const token = `__SPDX_${placeholders.length}__`;
    placeholders.push(m.trim());
    return '\n' + token;
  });
  // match /* SPDX-License-Identifier: ... */
  content = content.replace(/\/\*\s*SPDX-License-Identifier:[\s\S]*?\*\//g, (m) => {
    const token = `__SPDX_${placeholders.length}__`;
    placeholders.push(m);
    return token;
  });

  return { content, placeholders };
}

function restorePlaceholders(content, placeholders) {
  let idx = 0;
  content = content.replace(/__SHEBANG_\d+__|__SPDX_\d+__/g, () => placeholders[idx++] || '');
  return content;
}

function removeCommentsHeuristic(content, ext) {
  // First remove block comments (/* */) safely after placeholders removed
  // Then remove // line comments
  // Then remove # comments for shell/py/ps1
  // NOTE: This is a heuristic and may remove # inside strings. Backups are created.

  // remove block comments
  content = content.replace(/\/\*[\s\S]*?\*\//g, '\n');
  // remove // comments
  content = content.replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '\n');
  // remove # comments for certain extensions
  if (['.py','.sh','.ps1'].includes(ext)) {
    content = content.replace(/(^|\n)\s*#.*(?=\n|$)/g, '\n');
  }

  // collapse multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  return content;
}

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch (e) {}
}

(async function main(){
  console.log(`Root: ${ROOT}`);
  const files = await walk(ROOT);
  console.log(`Found ${files.length} candidate files`);
  const backups = [];
  const modified = [];
  await ensureDir(path.join(ROOT, '.comment-backups'));
  for (const file of files) {
    try {
      const rel = path.relative(ROOT, file);
      // skip the script itself if somehow matched
      if (rel === path.join('tools','remove-comments.js')) continue;
      let content = await fs.readFile(file, 'utf8');
      const ext = path.extname(file);
      const { content: placeholdered, placeholders } = preservePlaceholders(content);
      const cleaned = removeCommentsHeuristic(placeholdered, ext);
      const restored = restorePlaceholders(cleaned, placeholders);
      if (restored !== content) {
        modified.push(rel);
        const backupPath = path.join(ROOT, '.comment-backups', rel + '.bak');
        await ensureDir(path.dirname(backupPath));
        await fs.writeFile(backupPath, content, 'utf8');
        backups.push(backupPath);
        if (APPLY) {
          await fs.writeFile(file, restored, 'utf8');
          console.log(`Updated: ${rel}`);
        } else {
          console.log(`Would modify: ${rel}`);
        }
      }
    } catch (e) {
      console.error(`Error processing ${file}:`, e.message);
    }
  }

  console.log('\nSummary:');
  console.log(`Total candidates: ${files.length}`);
  console.log(`Files that would be/was changed: ${modified.length}`);
  if (!APPLY) console.log(`Run with --apply to perform changes. Backups are saved to .comment-backups/`);
  else console.log(`Backups saved under .comment-backups/; review and commit changes as needed.`);
})();
