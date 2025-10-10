/**
 * Checks that all required environment variables are set, exits if any are missing.
 */
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

// Ensure dotenv loads .env from the server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import { CCIPEventListener } from './ccip/ccipEventListener.js';
import { createHelia } from 'helia';

// Load environment variables
dotenv.config();

console.log(chalk.cyan.bold('🚀 Starting V7 Backend System...'));

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  const requiredDirs = [
    'logs',
    'temp'
  ];
  // Removed Python LLM Arbitrator API code
  // Check environment modes
  const isDev = (process.env.NODE_ENV === 'development') || (process.env.MOCK_IPFS === 'true');
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

/**
 * Start LLM Arbitrator API (Python FastAPI)
 * Note: This assumes you have the Python service set up
 */
// ...הוסר קוד Python LLM Arbitrator API...

/**
 * Start main V7 server
 */
function startV7Server() {
  console.log(chalk.green('🌐 Starting V7 Express Server...'));
  
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

/**
 * Start CCIP Event Listener for Oracle integration
 */
function startCCIPEventListener() {
  console.log(chalk.blue('🔗 Starting CCIP Event Listener...'));
  
  try {
    const ccipListener = new CCIPEventListener({
      rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
      chainId: parseInt(process.env.CHAIN_ID) || 31337,
      pollingInterval: 5000,
      enableLLM: true,
      arbitrationServiceAddress: process.env.ARBITRATION_SERVICE_ADDRESS,
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

/**
 * Main startup function
 */
async function startV7System() {
  try {
    console.log(chalk.cyan('📋 Initializing V7 Backend System...'));
    
    // Step 1: Ensure directories
    ensureDirectories();
    
    // Step 2: Check environment
    checkEnvironment();
    
    // Step 0: Start Helia IPFS node
    let heliaNode;
    try {
      heliaNode = await createHelia();
      console.log(chalk.blueBright('🟢 Helia IPFS node started. PeerId:'), heliaNode.libp2p.peerId.toString());
    } catch (err) {
      console.error(chalk.red('❌ Failed to start Helia IPFS node:'), err);
      process.exit(1);
    }

    // Step 1: Ensure directories
    ensureDirectories();

    // Step 2: Check environment
    checkEnvironment();

    // Step 3: Start V7 Express server
    const serverProcess = startV7Server();

    // Step 4: Start CCIP Event Listener for Oracle integration
    const ccipListener = startCCIPEventListener();

    console.log(chalk.cyan.bold('\n🎉 V7 Backend System Started Successfully!'));
    console.log(chalk.white('📍 Services:'));
    console.log(chalk.white(`   • V7 API Server: http://localhost:${process.env.SERVER_PORT || 3001}`));
    if (ccipListener) {
      console.log(chalk.white('   • CCIP Oracle Listener: Active'));
    }
    console.log(chalk.white('   • Helia IPFS Node: Active'));
    console.log(chalk.white(`   • Health Check: http://localhost:${process.env.SERVER_PORT || 3001}/api/v7/arbitration/health`));
    console.log(chalk.gray('\nPress Ctrl+C to stop all services'));
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Shutting down V7 Backend System...'));

      if (ccipListener) {
        ccipListener.stopListening();
        console.log(chalk.gray('✅ CCIP Event Listener stopped'));
      }

      serverProcess.kill('SIGTERM');
      console.log(chalk.gray('✅ V7 Server stopped'));

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