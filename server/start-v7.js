

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
  // 'MOCK_HELIA',
  'NODE_ENV',
  'LOG_LEVEL',
  // Add more as needed for your deployment
];
// List of required environment variables for V7 backend startup
const requiredVars = [
  'OLLAMA_HOST',
  'PORT',
  'CCIP_ENABLED',
  // 'HELIA_HOST',
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



async function isHeliaResponsive(url) {
  try {
    const res = await fetch(url, { method: 'POST' });
    if (res.ok) return true;
    if (res.status === 403 || res.status === 405) {
  console.log(chalk.yellow(`⚠️ Helia probe returned ${res.status} — treating as responsive`));
      return true;
    }
  } catch (err) {
  console.log(chalk.gray('ℹ️ Helia POST probe failed, will try GET: ' + (err && err.message)));
    try {
      const res2 = await fetch(url, { method: 'GET' });
      if (res2.ok) return true;
      if (res2.status === 403 || res2.status === 405) {
  console.log(chalk.yellow(`⚠️ Helia GET probe returned ${res2.status} — treating as responsive`));
        return true;
      }
    } catch (err2) {
  console.log(chalk.gray('ℹ️ Helia GET probe failed, will try POST with empty body: ' + (err2 && err2.message)));
      try {
        const res3 = await fetch(url, { method: 'POST', body: '' });
        if (res3.ok) return true;
        if (res3.status === 403 || res3.status === 405) {
          console.log(chalk.yellow(`⚠️ Helia empty-POST probe returned ${res3.status} — treating as responsive`));
          return true;
        }
      } catch (err3) {
  console.log(chalk.gray('🔍 Helia final probe attempt failed: ' + (err3 && err3.message)));
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
  const isDev = (process.env.NODE_ENV === 'development');
  const isProd = process.env.NODE_ENV === 'production';

  if (isDev) {
    console.log(chalk.cyan(`  🔧 Development Mode: ENABLED`));
    console.log(chalk.cyan(`     • Evidence: Mock evidence from JSON files`));
    console.log(chalk.cyan(`     • Validation: Bypassed for QmMock* CIDs`));
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
      receiverAddress: getContractAddress('CCIPArbitrationReceiver') || process.env.CCIP_RECEIVER_ADDRESS,
      senderAddress: getContractAddress('CCIPArbitrationSender') || process.env.CCIP_SENDER_ADDRESS,
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
    // Step 1: Ensure directories
    ensureDirectories();
    // Step 2: Check environment
    checkEnvironment();
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
    console.log(chalk.white('   • Helia Node: Active'));
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