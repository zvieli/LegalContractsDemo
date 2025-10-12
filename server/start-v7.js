

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
// List of optional environment variables for V7 backend startup
const optionalVars = [
  'MOCK_IPFS',
  'NODE_ENV',
  'LOG_LEVEL',
  // Add more as needed for your deployment
];
// List of required environment variables for V7 backend startup
const requiredVars = [
  'OLLAMA_HOST',
  'PORT',
  'CCIP_ENABLED',
  'IPFS_HOST',
  // Add more as needed for your deployment
];

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { execSync } from 'child_process';

// Ensure dotenv loads .env from the server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
import { spawn } from 'child_process';
import net from 'net';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import { CCIPEventListener } from './ccip/ccipEventListener.js';
import { getContractAddress } from './utils/deploymentLoader.js';
import { createHelia } from 'helia';

// Load environment variables
dotenv.config();

console.log(chalk.cyan.bold('🚀 Starting V7 Backend System...'));



async function isIpfsResponsive(url) {
  try {
    const res = await fetch(url, { method: 'POST' });
    if (res.ok) return true;
    if (res.status === 403 || res.status === 405) {
      console.log(chalk.yellow(`⚠️ IPFS probe returned ${res.status} — treating as responsive`));
      return true;
    }
  } catch (err) {
    console.log(chalk.gray('ℹ️ IPFS POST probe failed, will try GET: ' + (err && err.message)));
    try {
      const res2 = await fetch(url, { method: 'GET' });
      if (res2.ok) return true;
      if (res2.status === 403 || res2.status === 405) {
        console.log(chalk.yellow(`⚠️ IPFS GET probe returned ${res2.status} — treating as responsive`));
        return true;
      }
    } catch (err2) {
      console.log(chalk.gray('ℹ️ IPFS GET probe failed, will try POST with empty body: ' + (err2 && err2.message)));
      try {
        const res3 = await fetch(url, { method: 'POST', body: '' });
        if (res3.ok) return true;
        if (res3.status === 403 || res3.status === 405) {
          console.log(chalk.yellow(`⚠️ IPFS empty-POST probe returned ${res3.status} — treating as responsive`));
          return true;
        }
      } catch (err3) {
        console.log(chalk.gray('🔍 IPFS final probe attempt failed: ' + (err3 && err3.message)));
        return false;
      }
    }
  }
  return false;
}



function ensureDirectories() {
  const requiredDirs = [
    'logs',
    'temp'
  ];
  // Removed Python LLM Arbitrator API code
  // Check environment modes
  const isDev = (process.env.NODE_ENV === 'development') && (process.env.MOCK_IPFS === 'true');
  const isProd = process.env.NODE_ENV === 'production';

  if (isDev) {
    console.log(chalk.cyan(`  🔧 Development Mode: ENABLED`));
    console.log(chalk.cyan(`     • Evidence: Mock evidence from JSON files`));
    console.log(chalk.cyan(`     • Validation: Bypassed for QmMock* CIDs`));
  } else if (isProd) {
    console.log(chalk.green(`  🏭 Production Mode: ENABLED`));
    console.log(chalk.green(`     • Evidence: Helia local node (127.0.0.1:5001)`));
    console.log(chalk.green(`     • Validation: Real IPFS CID validation`));
    console.log(chalk.yellow(`     • ⚠️  Make sure IPFS daemon is running!`));
  } else {
    console.log(chalk.gray(`  ⚪ Legacy Mode: Default validation`));
  // List of required environment variables for V7 backend startup
  const requiredVars = [
    'OLLAMA_HOST',
    'PORT',
    'CCIP_ENABLED',
    'IPFS_HOST',
    // Add more as needed for your deployment
  ];
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
    console.log(chalk.yellow('   1. IPFS daemon must be running: ipfs daemon'));
    console.log(chalk.yellow('   2. API available at: http://127.0.0.1:5001'));
    console.log(chalk.yellow('   3. Test with: curl http://127.0.0.1:5001/api/v0/version'));
  }
}



// ...הוסר קוד Python LLM Arbitrator API...



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

async function startV7Server() {
  console.log(chalk.green('🌐 Starting V7 Express Server...'));

  const port = parseInt(process.env.SERVER_PORT || process.env.PORT || '3001', 10);
  try {
    const inUse = await isPortInUse(port);
    if (inUse) {
      console.log(chalk.yellow(`⚠️ Port ${port} already in use — assuming an existing V7 server is running. Skipping spawn.`));
      return null; // indicate we didn't spawn a child server
    }
  } catch (err) {
    console.log(chalk.gray('ℹ️ Could not check port usage:'), err.message || err);
  }

  const serverProcess = spawn('node', [path.join(__dirname, 'index.js')], {
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(chalk.green(`[V7 Server] ${data.toString().trim()}`));
  });

  serverProcess.stderr.on('data', (data) => {
    console.log(chalk.red(`[V7 Server Error] ${data.toString().trim()}`));
  });

  return serverProcess;
}



function startCCIPEventListener() {
  console.log(chalk.blue('🔗 Starting CCIP Event Listener...'));
  
  try {
    const ccipListener = new CCIPEventListener({
      rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
      chainId: parseInt(process.env.CHAIN_ID) || 31337,
      pollingInterval: 5000,
      enableLLM: true,
      arbitrationServiceAddress: getContractAddress('ArbitrationService') || process.env.ARBITRATION_SERVICE_ADDRESS,
      privateKey: process.env.PRIVATE_KEY
    });
    
    // Initialize and start listening
    ccipListener.initialize().then(() => {
      ccipListener.startListening();
      console.log(chalk.green('✅ CCIP Event Listener started successfully'));
    }).catch(error => {
      console.error(chalk.red('❌ Failed to start CCIP Event Listener:'), error);
    });
    
    return ccipListener;
  } catch (error) {
    console.error(chalk.red('❌ Failed to initialize CCIP Event Listener:'), error);
    return null;
  }
}



async function startV7System() {
  try {
    console.log(chalk.cyan('📋 Initializing V7 Backend System...'));
    
    // Step 1: Ensure directories
    ensureDirectories();
    
    // Step 2: Check environment
    checkEnvironment();
    
    // Step 0: Start Helia IPFS node only in development / mock mode.
    // In production we attempt to start an external IPFS daemon (IPFS_HOST) automatically.
    let heliaNode = null;
    let externalIpfsProcess = null;
    const useMockIpfs = (process.env.MOCK_IPFS === 'true') && (process.env.NODE_ENV === 'development');

    if (useMockIpfs) {
      try {
        heliaNode = await createHelia();
        console.log(chalk.blueBright('🟢 Helia IPFS node started. PeerId:'), heliaNode.libp2p.peerId.toString());
      } catch (err) {
        console.error(chalk.red('❌ Failed to start Helia IPFS node:'), err);
        process.exit(1);
      }
    } else {
      // Production: attempt to spawn the external `ipfs daemon` process and wait for it to respond.
      const ipfsHost = process.env.IPFS_HOST || 'http://127.0.0.1:5001';
      console.log(chalk.green('🌐 Production IPFS mode: attempting to start external IPFS daemon at'), ipfsHost);

      // Allow disabling auto-start via env var if needed
      const ipfsAutoStart = process.env.IPFS_AUTO_START !== 'false';
      const ipfsApiUrl = (ipfsHost.replace(/\/$/, '')) + '/api/v0/version';

      // First, check if an IPFS API is already responsive. If so, skip spawning.
      try {
        const found = await isIpfsResponsive(ipfsApiUrl);
        if (found) {
          console.log(chalk.green('ℹ️  Found existing IPFS daemon responding at ' + ipfsHost + ' — skipping spawn'));
        } else {
          throw new Error('No responsive IPFS API detected');
        }
      } catch (probeErr) {
        // No responsive API found — decide whether to auto-start
        if (!ipfsAutoStart) {
          console.log(chalk.yellow('⚠️ IPFS_AUTO_START=false and no IPFS API detected. Please start the IPFS daemon manually.'));
          console.error(chalk.red('❌ Aborting startup due to missing IPFS API'));
          process.exit(1);
        }

        console.log(chalk.cyan('▶️ No IPFS API detected, spawning `ipfs daemon` (requires `ipfs` in PATH)...'));
        try {
          externalIpfsProcess = spawn('ipfs', ['daemon'], { stdio: ['ignore', 'pipe', 'pipe'] });

          let spawnStderr = '';
          externalIpfsProcess.stdout.on('data', (chunk) => {
            const text = chunk.toString().trim();
            console.log(chalk.gray(`[ipfs] ${text}`));
          });
          externalIpfsProcess.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            spawnStderr += text;
            console.log(chalk.yellow(`[ipfs err] ${text.trim()}`));
          });
            // Short-circuit: if plugin parse errors appear quickly, attempt fallback earlier
            setTimeout(async () => {
              try {
                if (spawnStderr && /error loading plugins|invalid character/i.test(spawnStderr)) {
                  console.log(chalk.yellow('⚠️ Early-detected plugin/parse error from IPFS daemon. Attempting immediate fallback with a temporary IPFS repo...'));
                  const tmpPath = path.resolve(__dirname, 'temp-ipfs');
                  if (!existsSync(tmpPath)) mkdirSync(tmpPath, { recursive: true });
                  console.log(chalk.cyan('🔧 Initializing temporary IPFS repo at ' + tmpPath));
                  try {
                    execSync('ipfs init', { env: { ...process.env, IPFS_PATH: tmpPath }, stdio: 'ignore' });
                  } catch (e) {
                    // init may fail if already initialized; ignore
                  }
                  try {
                    execSync('ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin "[\"*\"]"', { env: { ...process.env, IPFS_PATH: tmpPath } });
                    execSync('ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods "[\"GET\", \"POST\", \"PUT\", \"DELETE\"]"', { env: { ...process.env, IPFS_PATH: tmpPath } });
                    execSync('ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers "[\"Authorization\", \"Content-Type\"]"', { env: { ...process.env, IPFS_PATH: tmpPath } });
                  } catch (cfgErr) {
                    console.warn('⚠️ Failed to set CORS on temp IPFS repo:', cfgErr.message);
                  }
                  if (externalIpfsProcess) {
                    try { externalIpfsProcess.kill(); } catch (e) {}
                  }
                  externalIpfsProcess = spawn('ipfs', ['daemon'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, IPFS_PATH: tmpPath } });
                  externalIpfsProcess.stdout.on('data', (chunk) => console.log(chalk.gray(`[ipfs tmp] ${chunk.toString().trim()}`)));
                  externalIpfsProcess.stderr.on('data', (chunk) => console.log(chalk.yellow(`[ipfs tmp err] ${chunk.toString().trim()}`)));
                }
              } catch (e) {
                console.warn('⚠️ Immediate fallback attempt failed:', e.message);
              }
            }, 2500);
          externalIpfsProcess.on('error', (err) => {
            console.error(chalk.yellow('⚠️ ipfs daemon spawn error:'), err.message || err);
            console.error(chalk.yellow('Will poll the configured IPFS API for a short period in case another daemon is starting.'));
            // don't exit immediately; continue to polling below
          });

          // Poll the IPFS API until responsive or timeout
          const start = Date.now();
          const timeoutMs = parseInt(process.env.IPFS_START_TIMEOUT_MS || '30000', 10);

          await new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
              try {
                const ok = await isIpfsResponsive(ipfsApiUrl);
                if (ok) {
                  clearInterval(interval);
                  console.log(chalk.green('✅ IPFS daemon is responsive at ' + ipfsHost));
                  resolve();
                }
              } catch (err) {
                if (Date.now() - start > timeoutMs) {
                  clearInterval(interval);
                  console.error(chalk.red(`❌ IPFS daemon did not respond within ${timeoutMs}ms`));
                  reject(err);
                }
              }
            }, 1000);
          }).catch((err) => {
            // If polling failed, exit with error
            console.error(chalk.red('❌ Aborting startup due to IPFS unavailability.'));
            if (externalIpfsProcess) externalIpfsProcess.kill();
            process.exit(1);
          });

        } catch (err) {
          console.error(chalk.red('❌ Unexpected error while starting external IPFS daemon:'), err);
          process.exit(1);
        }
      }
    }

    // Step 1: Ensure directories
    ensureDirectories();

    // Step 2: Check environment
    checkEnvironment();

  // Step 3: Start V7 Express server
  const serverProcess = await startV7Server();

    // Step 4: Start CCIP Event Listener for Oracle integration
    const ccipListener = startCCIPEventListener();

    console.log(chalk.cyan.bold('\n🎉 V7 Backend System Started Successfully!'));
    console.log(chalk.white('📍 Services:'));
    console.log(chalk.white(`   • V7 API Server: http://localhost:${process.env.SERVER_PORT || 3001}`));
    if (ccipListener) {
      console.log(chalk.white('   • CCIP Oracle Listener: Active'));
    }
    if (heliaNode) {
      console.log(chalk.white('   • Helia IPFS Node: Active'));
    } else {
      console.log(chalk.white('   • External IPFS Daemon: configured at ' + (process.env.IPFS_HOST || 'http://127.0.0.1:5001')));
    }
    console.log(chalk.white(`   • Health Check: http://localhost:${process.env.SERVER_PORT || 3001}/api/v7/arbitration/health`));
    console.log(chalk.gray('\nPress Ctrl+C to stop all services'));
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
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

      if (externalIpfsProcess) {
        try {
          externalIpfsProcess.kill();
          console.log(chalk.gray('✅ External IPFS daemon process killed'));
        } catch (e) {
          console.log(chalk.yellow('⚠️ Failed to kill external IPFS process:'), e.message);
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