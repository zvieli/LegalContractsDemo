// Dispute history endpoint
const disputeHistory = require('./modules/disputeHistory.js');

app.get('/api/dispute-history/:caseId', (req, res) => {
  try {
    const history = disputeHistory.getDisputeHistory(req.params.caseId);
    res.json(history);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
// Arbitration endpoint for batch integration
app.post('/api/arbitrate-batch', async (req, res) => {
  try {
    const { caseId, batchId, merkleRoot, proofs, evidenceItems, disputeType, requestedAmount } = req.body;
    if (!caseId || !merkleRoot || !evidenceItems || !proofs) {
      return res.status(400).json({ error: 'Missing required batch/arbitration fields' });
    }
    // Prepare arbitration payload
    const arbitrationPayload = {
      caseId,
      batchId,
      merkleRoot,
      proofs,
      evidenceItems,
      disputeType: disputeType || 0,
      requestedAmount: requestedAmount || 0,
      timestamp: Date.now()
    };
    // Use LLM/Arbitrator (simulate or real)
    let result;
    if (processV7ArbitrationWithOllama) {
      result = await processV7ArbitrationWithOllama(arbitrationPayload);
    } else {
      result = await processV7Arbitration(arbitrationPayload);
    }
    res.json({ success: true, arbitration: result });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
/**
 * ArbiTrust V7 Backend Server
 * Main Express server handling evidence validation, LLM arbitration triggers,
 * and time management for the V7 architecture.
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ethers } from 'ethers';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

// 🔧 Environment Mode Configuration
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// IPFS Daemon Management
let ipfsDaemonProcess = null;
const execAsync = promisify(exec);

// 🏭 IPFS Daemon Auto-Start for Production Mode
async function startIPFSDaemon() {
  if (isDevelopment) {
    console.log('🔧 Development Mode: Skipping IPFS daemon auto-start');
    return true;
  }

  try {
    console.log('🔄 Production Mode: Checking IPFS daemon status...');
    
    // Check if IPFS daemon is already running
    try {
      const response = await fetch('http://127.0.0.1:5001/api/v0/version', {
        method: 'POST',
        timeout: 3000
      });
      if (response.ok) {
        console.log('✅ IPFS daemon already running');
        return true;
      }
      if (response.status === 403) {
        console.log('🔧 IPFS daemon running but CORS not configured - will configure it');
        await configureIPFSCORS();
        return true;
      }
    } catch (error) {
      console.log('📡 IPFS daemon not running, starting...');
    }

    // Initialize IPFS if needed
    await initializeIPFS();

    // Start IPFS daemon
    console.log('🚀 Starting IPFS daemon...');
    ipfsDaemonProcess = spawn('ipfs', ['daemon'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    // Wait for daemon to be ready
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout

    while (!isReady && attempts < maxAttempts) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        const response = await fetch('http://127.0.0.1:5001/api/v0/version', {
          method: 'POST',
          timeout: 2000
        });
        if (response.ok) {
          isReady = true;
          console.log('✅ IPFS daemon ready');
        }
      } catch (error) {
        attempts++;
        console.log(`⏳ Waiting for IPFS daemon... (${attempts}/${maxAttempts})`);
      }
    }

    if (!isReady) {
      throw new Error('IPFS daemon failed to start within 30 seconds');
    }

    // Handle daemon process events
    ipfsDaemonProcess.on('error', (error) => {
      console.error('❌ IPFS daemon error:', error.message);
    });

    ipfsDaemonProcess.on('exit', (code) => {
      console.log(`🔴 IPFS daemon exited with code ${code}`);
      ipfsDaemonProcess = null;
    });

    return true;

  } catch (error) {
    console.error('❌ Failed to start IPFS daemon:', error.message);
    console.error('💡 Please ensure IPFS is installed: https://docs.ipfs.tech/install/');
    console.error('💡 Or run manually: ipfs daemon');
    return false;
  }
}

async function stopIPFSDaemon() {
  if (ipfsDaemonProcess) {
    console.log('🔴 Stopping IPFS daemon...');
    ipfsDaemonProcess.kill('SIGTERM');
    ipfsDaemonProcess = null;
  }
}

// Initialize IPFS repository if needed
async function initializeIPFS() {
  try {
    console.log('🔧 Checking IPFS initialization...');
    const { stdout } = await execAsync('ipfs id');
    console.log('✅ IPFS already initialized');
    return true;
  } catch (error) {
    console.log('🔧 Initializing IPFS repository...');
    try {
      await execAsync('ipfs init');
      console.log('✅ IPFS initialized successfully');
      await configureIPFSCORS();
      return true;
    } catch (initError) {
      console.error('❌ Failed to initialize IPFS:', initError.message);
      return false;
    }
  }
}

// Configure IPFS CORS settings
async function configureIPFSCORS() {
  try {
    console.log('🔧 Configuring IPFS CORS settings...');
    
    const corsCommands = [
      'ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin "[\"*\"]"',
      'ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods "[\"GET\", \"POST\", \"PUT\", \"DELETE\"]"',
      'ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers "[\"Authorization\", \"Content-Type\"]"'
    ];
    
    for (const cmd of corsCommands) {
      await execAsync(cmd);
    }
    
    console.log('✅ IPFS CORS configured successfully');
    return true;
  } catch (error) {
    console.error('⚠️ Failed to configure IPFS CORS:', error.message);
    console.log('💡 IPFS will work but may have CORS issues');
    return false;
  }
}

// Environment logging
if (isDevelopment) {
  console.log(`🔧 Development Mode: ENABLED - Limited functionality`);
} else if (isProduction) {
  console.log(`🏭 Production Mode: ENABLED - Using Helia local node`);
  console.log(`🔗 Helia Endpoint: http://127.0.0.1:5001`);
} else {
  console.log(`⚪ Default Mode: Using legacy validation`);
}

// V7 Modules
import { validateIPFSEvidence } from './modules/evidenceValidator.js';
import { triggerLLMArbitration, handleLLMResponse } from './modules/llmArbitration.js';
import { calculateLateFee, getTimeBasedData } from './modules/timeManagement.js';
import { llmArbitrationSimulator, processV7Arbitration } from './modules/llmArbitrationSimulator.js';

// Ollama integration with conditional loading
let ollamaLLMArbitrator = null;
let processV7ArbitrationWithOllama = null;

// Load Ollama module after server setup
async function loadOllamaModule() {
  try {
    const ollamaModule = await import('./modules/ollamaLLMArbitrator.js');
    ollamaLLMArbitrator = ollamaModule.ollamaLLMArbitrator;
    processV7ArbitrationWithOllama = ollamaModule.processV7ArbitrationWithOllama;
    console.log('✅ Ollama module loaded successfully');
    return true;
  } catch (error) {
    console.warn('⚠️ Ollama module failed to load:', error.message);
    console.log('🔄 Ollama features will be disabled');
    return false;
  }
}

// 🏭 Production Mode: Helia Evidence Fetching
const HELIA_LOCAL_API = 'http://127.0.0.1:5001';

async function fetchEvidenceFromHelia(cid) {
  try {
    console.log(`🔗 Production Mode: Fetching CID ${cid} from Helia node...`);
    
    // IPFS API requires POST method
    const response = await fetch(`${HELIA_LOCAL_API}/api/v0/cat?arg=${cid}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Helia API error: ${response.status} ${response.statusText}`);
    }

    const contentText = await response.text();
    
    // Try to parse as JSON, fallback to text
    let evidenceData;
    try {
      evidenceData = JSON.parse(contentText);
    } catch {
      // If not JSON, treat as plain text evidence
      evidenceData = {
        id: `helia-${cid}`,
        content: contentText,
        type: 'text',
        cid: cid,
        timestamp: Math.floor(Date.now() / 1000),
        source: 'helia-local'
      };
    }

    console.log(`✅ Successfully fetched evidence from Helia: ${cid}`);
    return evidenceData;

  } catch (error) {
    console.error(`❌ Failed to fetch evidence from Helia:`, error.message);
    throw new Error(`Unable to fetch CID ${cid} from Helia local node. Is IPFS daemon running on ${HELIA_LOCAL_API}?`);
  }
}

async function validateEvidenceWithHelia(evidenceCID) {
  // In production mode, validate against Helia
  if (isProduction) {
    try {
      await fetchEvidenceFromHelia(evidenceCID);
      return true;
    } catch (error) {
      console.error(`🏭 Production validation failed for ${evidenceCID}:`, error.message);
      return false;
    }
  }
  
  // In development mode, skip validation
  if (isDevelopment) {
    console.log(`🔧 Dev Mode: Skipping evidence validation for ${evidenceCID}`);
    return true;
  }
  
  // Fallback to original validation
  return await validateIPFSEvidence(evidenceCID);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;


// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Global logger for /api/v7 endpoints
app.use('/api/v7', (req, res, next) => {
  console.warn(`[API LOG] ${req.method} ${req.originalUrl}`);
  next();
});
app.use(bodyParser.urlencoded({ extended: true }));



// V7 Evidence API - CID-based
app.post('/api/v7/dispute/report', async (req, res) => {
  try {
    const { contractAddress, disputeType, requestedAmount, evidenceCID, disputeId } = req.body;

    // Validate required fields
    if (!contractAddress || !evidenceCID || requestedAmount === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: contractAddress, evidenceCID, requestedAmount' 
      });
    }

    // 🔧 Evidence validation based on environment mode
    const isValidEvidence = await validateEvidenceWithHelia(evidenceCID);
    if (!isValidEvidence) {
      let errorMsg = 'Invalid or inaccessible IPFS evidence CID';
      if (isDevelopment) {
        errorMsg = 'Evidence validation disabled in development mode';
      } else if (isProduction) {
        errorMsg = 'Invalid CID or Helia local node unreachable. Is IPFS daemon running on 127.0.0.1:5001?';
      }
      return res.status(400).json({ error: errorMsg });
    }

    // Get evidence content based on mode
    let evidenceContent = null;
    let evidenceSource = 'unknown';
    
    if (isProduction) {
      // Production: fetch from Helia
      try {
        evidenceContent = await fetchEvidenceFromHelia(evidenceCID);
        evidenceSource = 'helia';
      } catch (error) {
        console.error('Failed to fetch from Helia:', error.message);
        // Continue without content, validation already passed
      }
    } else if (isDevelopment) {
      // Development: no evidence fetching
      evidenceSource = 'development-skip';
    }

    // Prepare dispute data for LLM
    const disputeData = {
      contractAddress,
      disputeType: disputeType || 0,
      requestedAmount,
      evidenceCID,
      disputeId: disputeId || 0,
      timestamp: Date.now(),
      developmentMode: isDevelopment,
      evidenceSource,
      evidencePreview: evidenceContent ? evidenceContent.content.substring(0, 100) + '...' : 'Evidence content not available'
    };

    // Trigger LLM arbitration process
    const arbitrationRequest = await triggerLLMArbitration(disputeData);

    // Build response
    const response = {
      success: true,
      disputeData,
      arbitrationRequestId: arbitrationRequest.requestId,
      message: 'Dispute reported and LLM arbitration initiated'
    };

    // Add environment-specific notes
    if (isDevelopment) {
      response.developmentNote = 'Development mode - evidence validation skipped';
    } else if (isProduction) {
      response.productionNote = 'Evidence validated through Helia local node';
    }

    res.json(response);

  } catch (error) {
    console.error('Error in dispute report:', error);
    res.status(500).json({ 
      error: 'Internal server error during dispute reporting',
      details: error.message 
    });
  }
});

// V7 Appeal API - Enhanced with CID validation
app.post('/api/v7/dispute/appeal', async (req, res) => {
  try {
    const { contractAddress, disputeId, evidenceCID, appealReason } = req.body;

    if (!contractAddress || disputeId === undefined || !evidenceCID) {
      return res.status(400).json({ 
        error: 'Missing required fields: contractAddress, disputeId, evidenceCID' 
      });
    }

    // Validate IPFS CID for appeal evidence
    const isValidEvidence = await validateIPFSEvidence(evidenceCID);
    if (!isValidEvidence) {
      return res.status(400).json({ 
        error: 'Invalid or inaccessible IPFS appeal evidence CID' 
      });
    }

    // Prepare appeal data for LLM
    const appealData = {
      contractAddress,
      disputeId,
      evidenceCID,
      appealReason: appealReason || 'Appeal submitted',
      timestamp: Date.now(),
      type: 'appeal'
    };

    // Trigger LLM arbitration for appeal
    const arbitrationRequest = await triggerLLMArbitration(appealData);

    res.json({
      success: true,
      appealData,
      arbitrationRequestId: arbitrationRequest.requestId,
      message: 'Appeal submitted and LLM arbitration initiated'
    });

  } catch (error) {
    console.error('Error in appeal submission:', error);
    res.status(500).json({ 
      error: 'Internal server error during appeal submission',
      details: error.message 
    });
  }
});

// V7 Time Management API
app.post('/api/v7/rent/calculate-payment', async (req, res) => {
  try {
    const { contractAddress, baseAmount, dueDate, lateFeeBps } = req.body;

    if (!contractAddress || !baseAmount || !dueDate) {
      return res.status(400).json({ 
        error: 'Missing required fields: contractAddress, baseAmount, dueDate' 
      });
    }

    // Calculate late fee
    const lateFee = calculateLateFee(dueDate, baseAmount, lateFeeBps || 500); // Default 5%
    const totalAmount = parseFloat(baseAmount) + lateFee;

    // Get time-based contract data
    const timeData = getTimeBasedData(dueDate);

    res.json({
      success: true,
      baseAmount: parseFloat(baseAmount),
      lateFee,
      totalAmount,
      timeData,
      isOverdue: timeData.isOverdue,
      daysOverdue: timeData.daysOverdue
    });

  } catch (error) {
    console.error('Error in payment calculation:', error);
    res.status(500).json({ 
      error: 'Internal server error during payment calculation',
      details: error.message 
    });
  }
});

// V7 LLM Response Webhook (for Chainlink Functions callback)
app.post('/api/v7/llm/callback', async (req, res) => {
  try {
    const { requestId, result, contractAddress, disputeId } = req.body;

    if (!requestId || !result || !contractAddress) {
      return res.status(400).json({ 
        error: 'Missing required fields: requestId, result, contractAddress' 
      });
    }

    // Handle LLM response and execute on-chain resolution
    const resolutionResult = await handleLLMResponse(requestId, result, contractAddress, disputeId);

    res.json({
      success: true,
      requestId,
      resolutionResult,
      message: 'LLM response processed and resolution executed'
    });

  } catch (error) {
    console.error('Error in LLM callback:', error);
    res.status(500).json({ 
      error: 'Internal server error during LLM callback processing',
      details: error.message 
    });
  }
});

// V7 Debug endpoints
app.get('/api/v7/debug/evidence/:cid', async (req, res) => {
  try {
    const { cid } = req.params;
    
    // 🔧 Development Mode: Skip validation
    if (isDevelopment) {
      return res.json({
        cid,
        isValid: true,
        evidence: {
          id: `dev-${cid}`,
          content: 'Development mode - validation skipped',
          type: 'development'
        },
        mode: 'development',
        timestamp: new Date().toISOString(),
        note: 'Development mode - evidence validation disabled'
      });
    }
    
    // 🏭 Production Mode: Fetch from Helia
    if (isProduction) {
      try {
        const evidence = await fetchEvidenceFromHelia(cid);
        return res.json({
          cid,
          isValid: true,
          evidence: evidence,
          mode: 'production',
          source: 'helia-local',
          timestamp: new Date().toISOString(),
          note: 'Evidence fetched from Helia local node'
        });
      } catch (error) {
        return res.status(400).json({
          cid,
          isValid: false,
          mode: 'production',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Legacy validation for other modes
    const validationResult = await validateIPFSEvidence(cid);
    
    res.json({
      cid,
      isValid: validationResult,
      mode: 'legacy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🏭 Production Mode: IPFS daemon management endpoint
app.post('/api/v7/debug/ipfs/restart', async (req, res) => {
  if (!isProduction) {
    return res.status(403).json({ 
      error: 'IPFS daemon management only available in production mode',
      mode: isDevelopment ? 'development' : 'legacy'
    });
  }
  
  try {
    console.log('🔄 Manual IPFS daemon restart requested...');
    
    // Stop existing daemon
    await stopIPFSDaemon();
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start daemon again
    const success = await startIPFSDaemon();
    
    res.json({
      success,
      message: success ? 'IPFS daemon restarted successfully' : 'Failed to restart IPFS daemon',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to restart IPFS daemon',
      details: error.message 
    });
  }
});

// 🔧 Development Mode: Limited functionality
app.get('/api/v7/debug/development-info', async (req, res) => {
  if (!isDevelopment) {
    return res.status(403).json({ 
      error: 'Development info only available in development mode',
      hint: 'Set NODE_ENV=development to enable development features' 
    });
  }
  
  try {
    res.json({
      mode: 'development',
      features: {
        evidenceValidation: 'disabled',
        ipfsDaemon: 'not-required',
        heliaIntegration: 'disabled'
      },
      usage: 'Development mode has limited functionality - use production mode for full features',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// V7 LLM Arbitration with Ollama API
app.post('/api/v7/arbitration/ollama', async (req, res) => {
  try {
    if (!processV7ArbitrationWithOllama) {
      return res.status(503).json({ 
        error: 'Ollama service not available',
        fallback: 'Use /api/v7/arbitration/simulate for simulation mode'
      });
    }

    const arbitrationData = req.body;

    // Validate required fields
    if (!arbitrationData.contract_text && !arbitrationData.evidence_text) {
      return res.status(400).json({ 
        error: 'Missing required fields: contract_text or evidence_text' 
      });
    }

    // Process arbitration using Ollama LLM (with fallback to simulation)
    const result = await processV7ArbitrationWithOllama(arbitrationData);

    res.json({
      success: true,
      llm_used: result.llm_used || false,
      model: result.model || 'fallback-simulation',
      ...result
    });

  } catch (error) {
    console.error('Error in Ollama LLM arbitration:', error);
    res.status(500).json({ 
      error: 'Internal server error during Ollama arbitration',
      details: error.message 
    });
  }
});

// V7 LLM Arbitration Simulation API
app.post('/api/v7/arbitration/simulate', async (req, res) => {
  try {
    const arbitrationData = req.body;

    // Validate required fields
    if (!arbitrationData.contract_text && !arbitrationData.evidence_text) {
      return res.status(400).json({ 
        error: 'Missing required fields: contract_text or evidence_text' 
      });
    }

    // Process arbitration using simulation
    const result = await processV7Arbitration(arbitrationData);

    res.json({
      success: true,
      simulation: true,
      ...result
    });

  } catch (error) {
    console.error('Error in LLM arbitration simulation:', error);
    res.status(500).json({ 
      error: 'Internal server error during arbitration simulation',
      details: error.message 
    });
  }
});

// V7 Ollama Health Check API
app.get('/api/v7/arbitration/ollama/health', async (req, res) => {
  try {
    if (!ollamaLLMArbitrator) {
      return res.json({
        healthy: false,
        error: 'Ollama module not loaded',
        timestamp: new Date().toISOString()
      });
    }

    const stats = await ollamaLLMArbitrator.getStats();

    res.json({
      healthy: stats.healthy,
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ 
      healthy: false,
      error: error.message 
    });
  }
});

// V7 LLM Health Check API
app.get('/api/v7/arbitration/health', async (req, res) => {
  try {
    const isHealthy = await llmArbitrationSimulator.checkHealth();
    const stats = llmArbitrationSimulator.getStats();

    res.json({
      healthy: isHealthy,
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ 
      healthy: false,
      error: error.message 
    });
  }
});

app.get('/api/v7/debug/time/:timestamp', (req, res) => {
  try {
    const { timestamp } = req.params;
    const timeData = getTimeBasedData(parseInt(timestamp));
    
    res.json({
      inputTimestamp: timestamp,
      timeData,
      currentTime: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'POST /api/v7/dispute/report',
      'POST /api/v7/dispute/appeal', 
      'POST /api/v7/rent/calculate-payment',
      'POST /api/v7/llm/callback',
      'POST /api/v7/arbitration/ollama',
      'POST /api/v7/arbitration/simulate',
      'GET /api/v7/arbitration/ollama/health',
      'GET /api/v7/arbitration/health',
      'GET /api/v7/debug/evidence/:cid',
      'GET /api/v7/debug/development-info',
      'POST /api/v7/debug/ipfs/restart',
      'GET /api/v7/debug/time/:timestamp'
    ]
  });
});

// Batch management endpoints (persistent Merkle batches)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const evidenceBatch = require('./modules/evidenceBatch.js');

// POST /api/batch - create batch for caseId
app.post('/api/batch', async (req, res) => {
  try {
    const { caseId, evidenceItems } = req.body;
    if (!caseId || !Array.isArray(evidenceItems) || evidenceItems.length === 0) {
      return res.status(400).json({ error: 'Missing caseId or evidenceItems' });
    }
    const batch = await evidenceBatch.createBatch(caseId, evidenceItems);
    res.json(batch);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/batch/:caseId - get all batches for caseId
app.get('/api/batch/:caseId', (req, res) => {
  try {
    const batches = evidenceBatch.getBatches(req.params.caseId);
    res.json(batches);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 ArbiTrust V7 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/v7/arbitration/health`);
  
  // 🏭 Auto-start IPFS daemon for production mode
  if (isProduction) {
    const ipfsReady = await startIPFSDaemon();
    if (!ipfsReady) {
      console.warn('⚠️ IPFS daemon failed to start - production features may be limited');
      console.warn('💡 Run manually: ipfs daemon');
    }
  }
  
  // Environment-specific initialization
  if (isDevelopment) {
    console.log('🔧 Development Mode Configuration:');
    console.log('   • Evidence: Validation disabled');
    console.log('   • IPFS: Daemon auto-start disabled');
    console.log(`📝 Development info available at: http://localhost:${PORT}/api/v7/debug/development-info`);
  } else if (isProduction) {
    console.log('🏭 Production Mode Configuration:');
    console.log('   • Evidence: Helia local node (127.0.0.1:5001)');
    console.log('   • Validation: Real IPFS CID validation');
    console.log('   • IPFS: Auto-started daemon');
    console.log(`🔗 Test Helia: curl http://127.0.0.1:5001/api/v0/version`);
  } else {
    console.log('⚪ Legacy Mode: Using original evidence validation');
  }
  
  // Load Ollama module after server starts
  const ollamaLoaded = await loadOllamaModule();
  
  // API endpoints
  if (ollamaLoaded) {
    console.log(`🤖 Ollama Arbitration: http://localhost:${PORT}/api/v7/arbitration/ollama`);
  }
  console.log(`🎯 Simulation Arbitration: http://localhost:${PORT}/api/v7/arbitration/simulate`);
  console.log(`🔧 Debug endpoints available at /api/v7/debug/`);
  
  // Mode-specific documentation
  console.log('\n📋 Usage Instructions:');
  if (isDevelopment) {
    console.log('   Development Mode - Limited functionality:');
    console.log('   • Evidence validation disabled');
    console.log('   • Use production mode for full features');
  } else if (isProduction) {
    console.log('   Production Mode - Use real IPFS CIDs:');
    console.log('   • IPFS daemon: Auto-started');
    console.log('   • Upload evidence: ipfs add <file>');
    console.log('   • Use returned CID in API calls');
  }
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down ArbiTrust V7 Server...');
  await stopIPFSDaemon();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Shutting down ArbiTrust V7 Server...');
  await stopIPFSDaemon();
  process.exit(0);
});

export default app;