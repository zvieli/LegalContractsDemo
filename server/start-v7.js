#!/usr/bin/env node

/**
 * V7 Backend System - Start Script
 * Complete initialization and startup for all V7 components
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

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
    'RPC_URL'
  ];
  
  console.log(chalk.yellow('🔧 Environment Configuration:'));
  
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
    
    console.log(chalk.cyan.bold('\n🎉 V7 Backend System Started Successfully!'));
    console.log(chalk.white('📍 Services:'));
    console.log(chalk.white(`   • V7 API Server: http://localhost:${process.env.SERVER_PORT || 3001}`));
    if (llmProcess) {
      console.log(chalk.white('   • LLM Arbitrator API: http://localhost:8000'));
    }
    console.log(chalk.white('   • Health Check: http://localhost:3001/api/v7/health'));
    console.log(chalk.gray('\nPress Ctrl+C to stop all services'));
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Shutting down V7 Backend System...'));
      
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