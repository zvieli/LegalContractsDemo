const { execSync } = require('child_process');
const path = require('path');

// Playwright global setup: ensure an Active NDA exists before tests run.
// Behavior:
// 1. Run nda-activate.cjs (quiet by default). If it reports Active, done.
// 2. If not active or the script fails, run nda-setup.cjs to deploy a fresh NDA
//    and then run nda-activate again to sign/deposit for the fresh instance.

const repoRoot = path.resolve(__dirname, '..', '..');
const ndaActivate = path.join(repoRoot, 'scripts', 'debug', 'nda-activate.cjs');
const ndaSetup = path.join(repoRoot, 'scripts', 'debug', 'nda-setup.cjs');

function runNodeScript(scriptPath, args = []) {
  const cmd = process.execPath; // node executable
  const finalArgs = [scriptPath, ...args];
  console.log('Running:', cmd, finalArgs.join(' '));
  return execSync([cmd, ...finalArgs].join(' '), {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
  });
}

module.exports = async () => {
  try {
    // Try to activate existing NDA (quiet)
    console.log('Global setup: attempting NDA activation (quiet)...');
    try {
      runNodeScript(ndaActivate);
      console.log('nda-activate completed. Please check logs above to confirm Active state.');
      return;
    } catch (err) {
      console.warn('nda-activate failed or did not reach Active. Will deploy fresh NDA.');
    }

    // Deploy a fresh NDA and activate it
    console.log('Global setup: deploying fresh NDA via nda-setup.cjs...');
    runNodeScript(ndaSetup);

    // After deploy, run activate again (debug mode for visibility)
    console.log('Global setup: running nda-activate (debug) for the freshly deployed NDA...');
    runNodeScript(ndaActivate, ['--debug']);

    console.log('Global setup: NDA deployment + activation done.');
  } catch (e) {
    console.error('Global setup failed:', e && e.message ? e.message : e);
    // Re-throw to fail Playwright setup so the test run fails loudly in CI
    throw e;
  }
};
