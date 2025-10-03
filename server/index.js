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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    version: 'V7',
    services: ['evidence-validation', 'llm-arbitration', 'time-management'],
    timestamp: new Date().toISOString()
  });
});

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

    // Validate IPFS CID
    const isValidEvidence = await validateIPFSEvidence(evidenceCID);
    if (!isValidEvidence) {
      return res.status(400).json({ 
        error: 'Invalid or inaccessible IPFS evidence CID' 
      });
    }

    // Prepare dispute data for LLM
    const disputeData = {
      contractAddress,
      disputeType: disputeType || 0,
      requestedAmount,
      evidenceCID,
      disputeId: disputeId || 0,
      timestamp: Date.now()
    };

    // Trigger LLM arbitration process
    const arbitrationRequest = await triggerLLMArbitration(disputeData);

    res.json({
      success: true,
      disputeData,
      arbitrationRequestId: arbitrationRequest.requestId,
      message: 'Dispute reported and LLM arbitration initiated'
    });

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
    const validationResult = await validateIPFSEvidence(cid);
    
    res.json({
      cid,
      isValid: validationResult,
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
      'GET /api/v7/debug/time/:timestamp'
    ]
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 ArbiTrust V7 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  
  // Load Ollama module after server starts
  const ollamaLoaded = await loadOllamaModule();
  
  if (ollamaLoaded) {
    console.log(`🤖 Ollama Arbitration: http://localhost:${PORT}/api/v7/arbitration/ollama`);
  }
  console.log(`🎯 Simulation Arbitration: http://localhost:${PORT}/api/v7/arbitration/simulate`);
  console.log(`🔧 Debug endpoints available at /api/v7/debug/`);
});

export default app;