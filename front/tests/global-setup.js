import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Playwright global setup (ESM): runs the unified nda-ensure script, with fallbacks
const repoRoot = path.resolve(__dirname, '..', '..');
const ndaEnsure = path.join(repoRoot, 'scripts', 'debug', 'nda-ensure.js');
const ndaActivate = path.join(repoRoot, 'scripts', 'debug', 'nda-activate.js');
const ndaSetup = path.join(repoRoot, 'scripts', 'debug', 'nda-setup.js');

function runNodeScript(scriptPath, args = [], envOverrides = {}) {
  // Resolve node executable path defensively so lint/build in browser contexts won't error
  let _proc = null;
  try { _proc = (typeof globalThis !== 'undefined' && globalThis.process) ? globalThis.process : null; } catch (e) { _proc = null; }
  const nodeExe = _proc && _proc.execPath ? _proc.execPath : 'node'; // absolute node path
  const fullArgs = [scriptPath, ...args];
  try { console.log('Running:', nodeExe, fullArgs.join(' ')); } catch (_) {}
  const res = execFileSync(nodeExe, fullArgs, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: Object.assign({}, (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env) ? globalThis.process.env : {}, envOverrides),
    windowsHide: true,
  });
  return res;
}

export default async function globalSetup() {
  try {
    console.log('Global setup: attempting unified nda-ensure...');
    try {
      runNodeScript(ndaEnsure, []);
      console.log('nda-ensure completed.');
      return;
    } catch (err) {
      console.warn('nda-ensure failed; falling back to activate/setup flow:', err && err.message ? err.message : err);
    }

    // Try activation; if it fails deploy and then activate
    try {
      runNodeScript(ndaActivate);
      console.log('nda-activate completed. NDA should be active.');
      return;
    } catch (err) {
      console.warn('nda-activate failed; will deploy fresh NDA:', err && err.message ? err.message : err);
    }

    // Deploy fresh NDA
    console.log('Global setup: deploying fresh NDA via nda-setup.js...');
    runNodeScript(ndaSetup);

    // Activate freshly deployed NDA
    console.log('Global setup: running nda-activate for freshly deployed NDA...');
    runNodeScript(ndaActivate, ['--debug']);

    console.log('Global setup: NDA deployment + activation done.');
  } catch (e) {
    console.error('Global setup failed:', e && e.message ? e.message : e);
    throw e;
  }
}

