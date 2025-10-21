#!/usr/bin/env node
// Remove review comment from text files in the repository
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(process.cwd());
const SKIP_DIRS = new Set(['node_modules', 'artifacts', 'cache', 'logs', '.git', 'dist', 'build', '__pycache__', '.github', '.vscode']);

function isTextFile(filePath) {
  const textExtensions = ['.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.sol', '.txt', '.ps1', '.sh', '.py', '.yml', '.yaml', '.html', '.css', '.scss', '.env', '.cfg', '.ini', '.lock', '.mdx', '.xml'];
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so'];
  
  const ext = path.extname(filePath).toLowerCase();
  return textExtensions.includes(ext) && !binaryExtensions.includes(ext);
}

function shouldSkipFile(filePath) {
  const skipPatterns = [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.min.js',
    '.bundle.js',
    '.log'
  ];
  
  return skipPatterns.some(pattern => filePath.includes(pattern));
}

function walk(dir) {
  let removedCount = 0;
  let skippedCount = 0;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          console.log(`⏭️  Skipping directory: ${fullPath}`);
          skippedCount++;
          continue;
        }
        const result = walk(fullPath);
        removedCount += result.removedCount;
        skippedCount += result.skippedCount;
      } else if (entry.isFile()) {
        // Skip binary files and specific file patterns
        if (!isTextFile(fullPath) || shouldSkipFile(fullPath)) {
          skippedCount++;
          continue;
        }
        
        try {
          const stats = fs.statSync(fullPath);
          if (stats.size === 0) {
            skippedCount++;
            continue;
          }
          
          const content = fs.readFileSync(fullPath, 'utf8');
          
          // Check if file contains the comment
          if (!content.includes(COMMENT_TO_REMOVE)) {
            skippedCount++;
            continue;
          }
          
          // Remove the comment line
          const lines = content.split('\n');
          const filteredLines = lines.filter(line => !line.includes(COMMENT_TO_REMOVE));
          const newContent = filteredLines.join('\n');
          
          // Write back only if content changed
          if (filteredLines.length < lines.length) {
            fs.writeFileSync(fullPath, newContent, 'utf8');
            console.log(`✅ Removed comment from: ${fullPath}`);
            removedCount++;
          } else {
            skippedCount++;
          }
          
        } catch (err) {
          console.error(`❌ Error processing ${fullPath}:`, err.message);
          skippedCount++;
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error reading directory ${dir}:`, err.message);
  }
  
  return { removedCount, skippedCount };
}

// Main execution
console.log('🐰 CodeRabbit Review Comment Remover');
console.log('📁 Scanning directory:', ROOT);
console.log('🗑️  Removing comment:', COMMENT_TO_REMOVE);
console.log('⏭️  Skipping directories:', Array.from(SKIP_DIRS).join(', '));
console.log('='.repeat(50));

const startTime = Date.now();
const result = walk(ROOT);
const endTime = Date.now();

console.log('='.repeat(50));
console.log('🎉 Completed!');
console.log(`✅ Removed comments from: ${result.removedCount} files`);
console.log(`⏭️  Skipped files: ${result.skippedCount}`);
console.log(`⏱️  Time taken: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);