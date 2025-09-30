#!/usr/bin/env node
// check-testing-deps.js
// Quick script to report outdated testing-related packages and to run tests and flag stderr lines.

import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// script is at front/scripts; package.json is at front/package.json
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

const testingDeps = [
  '@testing-library/react',
  '@testing-library/jest-dom',
  '@testing-library/user-event',
  'vitest',
  'jsdom',
  '@playwright/test'
]

console.log('Checking testing-related dependencies in', pkgPath)

for (const dep of testingDeps) {
  const current = pkg.devDependencies?.[dep] || pkg.dependencies?.[dep]
  if (current) console.log(`  - ${dep}: ${current}`)
}

console.log('\nRunning `npm --prefix . run test` to capture warnings...')
// Use a shell invocation which is generally more reliable across platforms
// Run the frontend test suite specifically
const cmd = `npm --prefix front run test`
const child = spawnSync(cmd, { stdio: 'inherit', shell: true })

if (child.error) {
  console.error('\nFailed to run tests:', child.error)
  process.exit(1)
}

if (child.status !== 0) {
  console.error('\nTests failed (exit code', child.status, ').')
  process.exit(child.status)
}

console.log('\nAll tests passed. If there are deprecation messages in stderr, inspect them above.')
