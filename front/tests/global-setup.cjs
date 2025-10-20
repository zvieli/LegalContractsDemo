const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Playwright global setup (CommonJS): runs the unified nda-ensure script
const repoRoot = path.resolve(__dirname, '..', '..');
const ndaEnsure = path.join(repoRoot, 'scripts', 'debug', 'nda-ensure.cjs');

function runNodeScript(scriptPath, args = [], envOverrides = {}) {
  const nodeExe = process.execPath; // absolute node path
  const fullCmd = [nodeExe, scriptPath, ...args].map(s => `"${s}"`).join(' ');
  console.log('Running:', fullCmd);
  return execSync(fullCmd, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: Object.assign({}, process.env, envOverrides),
    windowsHide: true,
  });
}

module.exports = async function globalSetup() {
  try {
    console.log('Global setup: running unified nda-ensure...');
    runNodeScript(ndaEnsure, []);
    console.log('nda-ensure completed. deployment-summary.json should be updated and NDA active.');
    return;
  } catch (err) {
    console.error('nda-ensure failed:', err && err.message ? err.message : err);
    throw err;
  }
};
