#!/usr/bin/env node

/**
 * V7 Backend System - Start Script
 * Complete initialization and startup for all V7 components
 */

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { CCIPEventListener } from './ccip/ccipEventListener.js';

// Load environment variables
dotenv.config();

console.log(chalk.cyan.bold('🚀 Starting V7 Backend System...'));

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  const requiredDirs = [
    'logs',
    'temp',
    'uploads',
    '../evidence_storage'
  ];
  
  requiredDirs.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(chalk.green(`✅ Created directory: ${dir}`));
    }
  });
}

/**
 * Check environment configuration
 */
function checkEnvironment() {
  const requiredVars = [
    'NODE_ENV',
    'SERVER_PORT'
  ];
  
  const optionalVars = [
    'LLM_ARBITRATOR_URL',
    'IPFS_GATEWAY_URL',
    'RPC_URL',
    'MOCK_IPFS'
  ];
  
  console.log(chalk.yellow('🔧 Environment Configuration:'));
  
  // Check environment modes
  const isDev = process.env.NODE_ENV === 'development' || process.env.MOCK_IPFS === 'true';
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
function startLLMArbitratorAPI() {
  console.log(chalk.magenta('🧠 Starting LLM Arbitrator API...'));
  
  // Check if Python service exists
  const pythonServicePath = '../arbitrator-api';
  
  if (existsSync(pythonServicePath)) {
    const pythonProcess = spawn('python', ['-m', 'uvicorn', 'main:app', '--reload', '--port', '8000'], {
      cwd: pythonServicePath,
      stdio: 'pipe'
    });
    
    pythonProcess.stdout.on('data', (data) => {
      console.log(chalk.magenta(`[LLM API] ${data.toString().trim()}`));
    });
    
    pythonProcess.stderr.on('data', (data) => {
      console.log(chalk.red(`[LLM API Error] ${data.toString().trim()}`));
    });
    
    return pythonProcess;
  } else {
    console.log(chalk.yellow('⚠️ Python LLM Arbitrator API not found. Using simulation mode.'));
    return null;
  }
}

/**
 * Start main V7 server
 */
function startV7Server() {
  console.log(chalk.green('🌐 Starting V7 Express Server...'));
  
  const serverProcess = spawn('node', ['index.js'], {
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
    
    // Step 3: Start Python LLM API (optional)
    const llmProcess = startLLMArbitratorAPI();
    
    // Step 4: Wait a moment for Python API to start
    if (llmProcess) {
      console.log(chalk.yellow('⏳ Waiting for LLM API to initialize...'));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Step 5: Start V7 Express server
    const serverProcess = startV7Server();
    
    // Step 6: Start CCIP Event Listener for Oracle integration
    const ccipListener = startCCIPEventListener();
    
    console.log(chalk.cyan.bold('\n🎉 V7 Backend System Started Successfully!'));
    console.log(chalk.white('📍 Services:'));
    console.log(chalk.white(`   • V7 API Server: http://localhost:${process.env.SERVER_PORT || 3001}`));
    if (llmProcess) {
      console.log(chalk.white('   • LLM Arbitrator API: http://localhost:8000'));
    }
    if (ccipListener) {
      console.log(chalk.white('   • CCIP Oracle Listener: Active'));
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
      
      if (llmProcess) {
        llmProcess.kill('SIGTERM');
        console.log(chalk.gray('✅ LLM Arbitrator API stopped'));
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