import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { spawn } from 'child_process';
import net from 'net';
import fs, { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';

// Load environment variables FIRST
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Runtime state for Helia/external daemon and spawned server
let externalHeliaProcess = null;
let heliaAvailable = false;
let heliaMode = 'unknown'; // 'external-http' | 'external-spawn' | 'inproc' | 'none'

// List of required environment variables for V7 backend startup
const requiredVars = [
  'OLLAMA_HOST',
  'PORT',
  'CCIP_ENABLED',
];

// List of optional environment variables for V7 backend startup
const optionalVars = [
  'NODE_ENV',
  'LOG_LEVEL',
];

function checkEnvironment() {
  let missingVars = [];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });
  if (missingVars.length > 0) {
    console.error(chalk.red(`❌ Missing required environment variables: ${missingVars.join(', ')}`));
    process.exit(1);
  }
}

function ensureDirectories() {
  const requiredDirs = [
    'logs',
    'temp'
  ];
  
  requiredDirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      console.log(chalk.green(`✅ Created directory: ${dir}`));
    }
  });
  
  // Check environment modes
  const isDev = (process.env.NODE_ENV === 'development');
  const isProd = process.env.NODE_ENV === 'production';

    if (isDev) {
      console.log(chalk.cyan(`  Development Mode: ENABLED`));
      console.log(chalk.cyan(`     • Evidence: Helia preferred. No mock fallbacks permitted.`));
      console.log(chalk.cyan(`     • Validation: Real Helia CID validation required.`));
  } else if (isProd) {
    console.log(chalk.green(`  🏭 Production Mode: ENABLED`));
    console.log(chalk.green(`     • Evidence: Helia local node (127.0.0.1:5001)`));
    console.log(chalk.green(`     • Validation: Real Helia CID validation`));
    console.log(chalk.green(`     • Helia node must be running!`));
  } else {
    console.log(chalk.gray(`  ⚪ Legacy Mode: Default validation`));
  }
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(chalk.green(`  ✅ ${varName}: ${value}`));
    } else {
      console.log(chalk.red(`  ❌ ${varName}: NOT SET (using default)`));
    }
  });
  
  optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(chalk.blue(`  ℹ️  ${varName}: ${value}`));
    } else {
      console.log(chalk.gray(`  ⚪ ${varName}: using default`));
    }
  });
  
  // Production mode warnings
  if (isProd) {
    console.log(chalk.yellow.bold('🏭 Production Mode Requirements:'));
    console.log(chalk.yellow('   1. Helia node must be running: see https://helia.io/'));
    console.log(chalk.yellow('   2. API available at: http://127.0.0.1:5001'));
    console.log(chalk.yellow('   3. Test with: curl http://127.0.0.1:5001/api/v0/version'));
  }
}

function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(1000);
    socket.once('error', onError);
    socket.once('timeout', onError);
    socket.connect(port, host, () => {
      socket.end();
      resolve(true);
    });
  });
}

// Simple HTTP probe for Helia (or other HTTP-API endpoints)
async function isHeliaResponsive(url, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(id);
    if (!res) return false;
    if (res.ok) return true;
    // Some Helia gateways may return 403/405 for certain endpoints but still be responsive
    if (res.status === 403 || res.status === 405) return true;
    return false;
  } catch (e) {
    return false;
  }
}

// Attempt to start an external Helia daemon via configured command (non-blocking)
function startExternalHelia(cmd, args = []) {
  try {
    console.log(chalk.cyan('[Helia] Starting external Helia daemon:'), cmd, args.join(' '));
    externalHeliaProcess = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    externalHeliaProcess.stdout.on('data', (d) => console.log(chalk.gray(`[Helia stdout] ${d.toString().trim()}`)));
    externalHeliaProcess.stderr.on('data', (d) => console.warn(chalk.yellow(`[Helia stderr] ${d.toString().trim()}`)));
    externalHeliaProcess.on('exit', (code, signal) => {
      console.warn(chalk.yellow(`[Helia] external process exited code=${code} signal=${signal}`));
      externalHeliaProcess = null;
      heliaAvailable = false;
      heliaMode = 'none';
    });

    return externalHeliaProcess;
  } catch (e) {
    console.error(chalk.red('[Helia] Failed to spawn external helia process:'), e && e.message ? e.message : e);
    externalHeliaProcess = null;
    return null;
  }
}

// wait/poll for Helia HTTP probe with timeout
async function waitForHelia(httpUrl, timeoutMs = 20000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await isHeliaResponsive(httpUrl, Math.min(3000, intervalMs));
    if (ok) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

async function startV7Server() {
  console.log(chalk.green('🌐 Starting V7 Express Server...'));

  const port = parseInt(process.env.SERVER_PORT || process.env.PORT || '3001', 10);
  try {
    const inUse = await isPortInUse(port);
    if (inUse) {
      console.log(chalk.yellow(`⚠️ Port ${port} already in use — assuming an existing V7 server is running. Skipping spawn.`));
      return null;
    }
  } catch (err) {
    console.log(chalk.gray('ℹ️ Could not check port usage:'), err.message || err);
  }

  const serverProcess = spawn('node', [path.join(__dirname, 'index.js')], {
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      AUTO_START_SERVER: 'true',
      SERVER_PORT: String(process.env.SERVER_PORT || process.env.PORT || '3001')
    }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(chalk.green(`[V7 Server] ${data.toString().trim()}`));
  });

  serverProcess.stderr.on('data', (data) => {
    console.log(chalk.red(`[V7 Server Error] ${data.toString().trim()}`));
  });

  // Watch for child server exit and errors so the wrapper can log and optionally act
  serverProcess.on('exit', (code, signal) => {
    console.warn(chalk.yellow(`[V7 Server] child process exited with code=${code} signal=${signal}`));
  });

  serverProcess.on('error', (err) => {
    console.error(chalk.red('[V7 Server] spawn error:'), err && err.stack ? err.stack : err);
  });

  return serverProcess;
}

async function startCCIPEventListener() {
  console.log(chalk.blue('🔗 Starting CCIP Event Listener...'));
  
  try {
    // Dynamic import to avoid circular dependencies
    const { CCIPEventListener } = await import('./ccip/ccipEventListener.js');
    const { getContractAddress } = await import('./utils/deploymentLoader.js');
    
    // If receiver address is missing in dev, attempt to populate from deployment-summary or run a local deploy
    let receiverAddress = getContractAddress('CCIPArbitrationReceiver') || process.env.CCIP_RECEIVER_ADDRESS;
    let senderAddress = getContractAddress('CCIPArbitrationSender') || process.env.CCIP_SENDER_ADDRESS;
    if (!receiverAddress && (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined)) {
      try {
        const summaryPath = path.join(__dirname, 'config', 'deployment-summary.json');
        if (existsSync(summaryPath)) {
          const json = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
          receiverAddress = receiverAddress || json?.contracts?.CCIPArbitrationReceiver?.address;
          senderAddress = senderAddress || json?.contracts?.CCIPArbitrationSender?.address;
          console.log(chalk.green('[CCIP] Loaded addresses from deployment-summary.json'));
        } else {
          // Try running local deploy script (best-effort, non-blocking)
          console.log(chalk.yellow('[CCIP] No deployment-summary found. Attempting local deploy (this may take a few seconds)...'));
          const deployProc = spawn('node', [path.join(__dirname, '..', 'scripts', 'deploy.js'), '--localhost'], { stdio: 'ignore', env: { ...process.env } });
          // give the deploy a short time to produce config
          await new Promise(r => setTimeout(r, 6000));
          if (existsSync(summaryPath)) {
            const json = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
            receiverAddress = receiverAddress || json?.contracts?.CCIPArbitrationReceiver?.address;
            senderAddress = senderAddress || json?.contracts?.CCIPArbitrationSender?.address;
            console.log(chalk.green('[CCIP] Loaded addresses after local deploy'));
          }
        }
      } catch (e) {
        console.warn(chalk.yellow('[CCIP] Auto-deploy or read of deployment-summary failed:'), e && e.message ? e.message : e);
      }
    }

    const ccipListener = new CCIPEventListener({
      rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
      chainId: parseInt(process.env.CHAIN_ID) || 31337,
      pollingInterval: 5000,
      enableLLM: true,
      receiverAddress: receiverAddress,
      senderAddress: senderAddress,
      arbitrationServiceAddress: getContractAddress('ArbitrationService') || process.env.ARBITRATION_SERVICE_ADDRESS,
      privateKey: process.env.PRIVATE_KEY
    });
    
    await ccipListener.initialize();
    ccipListener.startListening();
    console.log(chalk.green('✅ CCIP Event Listener started successfully'));
    
    return ccipListener;
  } catch (error) {
    console.error(chalk.red('❌ Failed to start CCIP Event Listener:'), error);
    return null;
  }
}

async function startV7System() {
  try {
    console.log(chalk.cyan.bold('🚀 Starting V7 Backend System...'));
    console.log(chalk.cyan('📋 Initializing V7 Backend System...'));
    
    // Step 1: Ensure directories
    ensureDirectories();
    
    // Step 2: Check environment
    checkEnvironment();

    // Step 2.1: Helia probe / startup flow
    try {
      const heliaHttp = process.env.HELIA_API || process.env.HELIA_HOST || 'http://127.0.0.1:5001/api/v0/version';
      // 1) Try direct HTTP probe
      const directOk = await isHeliaResponsive(heliaHttp, 2000);
      if (directOk) {
        heliaAvailable = true;
        heliaMode = 'external-http';
        console.log(chalk.green('[Helia] External Helia API seems available at'), heliaHttp);
      } else {
        // 2) If configured, try to spawn external helia daemon
        if ((process.env.START_EXTERNAL_HELIA || '').toString().toLowerCase() === 'true' && process.env.HELIA_CMD) {
          const cmd = process.env.HELIA_CMD;
          const args = process.env.HELIA_ARGS ? process.env.HELIA_ARGS.split(' ') : [];
          startExternalHelia(cmd, args);
          const ok = await waitForHelia(heliaHttp, 20000, 1500);
          if (ok) {
            heliaAvailable = true;
            heliaMode = 'external-spawn';
            console.log(chalk.green('[Helia] External Helia started and reachable'));
          } else {
            console.warn(chalk.yellow('[Helia] External Helia spawn attempted but HTTP probe failed'));
          }
        }
        // 3) If still not available, opt for in-process Helia if enabled
        if (!heliaAvailable && (process.env.START_INPROC_HELIA || '').toString().toLowerCase() === 'true') {
          heliaAvailable = true;
          heliaMode = 'inproc';
          console.log(chalk.cyan('[Helia] Using in-process Helia (START_INPROC_HELIA=true)'));
        }
      }
    } catch (e) {
      console.warn(chalk.yellow('[Helia] Probe/start flow failed:'), e && e.message ? e.message : e);
      heliaAvailable = false;
      heliaMode = 'none';
    }

    // Step 3: Start V7 Express server
    const serverProcess = await startV7Server();

    // Step 4: Start CCIP Event Listener for Oracle integration
    const ccipListener = await startCCIPEventListener();

    console.log(chalk.cyan.bold('\n🎉 V7 Backend System Started Successfully!'));
    console.log(chalk.white('📍 Services:'));
    console.log(chalk.white(`   • V7 API Server: http://localhost:${process.env.SERVER_PORT || 3001}`));
    if (ccipListener) {
      console.log(chalk.white('   • CCIP Oracle Listener: Active'));
    }
    console.log(chalk.white(`   • Health Check: http://localhost:${process.env.SERVER_PORT || 3001}/api/v7/arbitration/health`));
    // Helia status
    console.log(chalk.white(`   • Helia: ${heliaAvailable ? heliaMode : 'unavailable'}`));
    if (externalHeliaProcess) console.log(chalk.white(`     - external Helia PID: ${externalHeliaProcess.pid}`));
    console.log(chalk.gray('\nPress Ctrl+C to stop all services'));
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n🛑 Shutting down V7 Backend System...'));

      if (ccipListener) {
        ccipListener.stopListening();
        console.log(chalk.gray('✅ CCIP Event Listener stopped'));
      }

      if (serverProcess && typeof serverProcess.kill === 'function') {
        try {
          serverProcess.kill('SIGTERM');
          console.log(chalk.gray('✅ V7 Server stopped'));
        } catch (e) {
          console.log(chalk.yellow('⚠️ Failed to kill spawned V7 server process:'), e.message);
        }
      } else {
        console.log(chalk.gray('ℹ️ No spawned V7 server process to stop'));
      }

      if (externalHeliaProcess) {
        try {
          externalHeliaProcess.kill();
          console.log(chalk.gray('✅ External Helia daemon process killed'));
        } catch (e) {
          console.log(chalk.yellow('⚠️ Failed to kill external Helia process:'), e.message);
        }
      }
      console.log(chalk.cyan('👋 V7 Backend System shutdown complete'));
      process.exit(0);
    });
    
    // Keep process alive
    process.stdin.resume();
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to start V7 Backend System:'), error);
    process.exit(1);
  }
}

// Start the system
startV7System();