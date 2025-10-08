/**
 * V7 Backend Testing Endpoints
 * Additional endpoints specifically for testing and debugging
 */

import express from 'express';

const router = express.Router();

// Store for testing data
const testingData = {
  requests: [],
  events: [],
  metrics: {
    uptime: Date.now(),
    requestCount: 0,
    memory: process.memoryUsage()
  }
};

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  testingData.metrics.requestCount++;
  
  res.json({
    status: 'healthy',
    version: 'v7',
    timestamp: new Date().toISOString(),
    uptime: Date.now() - testingData.metrics.uptime
  });
});

/**
 * Configuration endpoint
 */
router.get('/config', (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV || 'development',
    serverPort: parseInt(process.env.SERVER_PORT) || 3002,
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
    chainId: parseInt(process.env.CHAIN_ID) || 31337,
    mockIpfs: process.env.MOCK_IPFS === 'true',
    useHelia: process.env.USE_HELIA === '1'
  });
});

/**
 * CCIP status endpoint
 */
router.get('/ccip/status', (req, res) => {
  res.json({
    eventListener: 'active',
    senderAddress: process.env.CCIP_SENDER_ADDRESS || null,
    receiverAddress: process.env.CCIP_RECEIVER_ADDRESS || null,
    arbitrationService: process.env.ARBITRATION_SERVICE_ADDRESS || null
  });
});

/**
 * CCIP configuration endpoint
 */
router.get('/ccip/config', (req, res) => {
  res.json({
    chainId: parseInt(process.env.CHAIN_ID) || 31337,
    pollingInterval: 5000,
    enableLLM: true,
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545'
  });
});

/**
 * CCIP requests endpoint
 */
router.get('/ccip/requests', (req, res) => {
  res.json(testingData.requests);
});

/**
 * CCIP events endpoint
 */
router.get('/ccip/events', (req, res) => {
  res.json(testingData.events);
});

/**
 * LLM health check
 */
router.get('/llm/health', (req, res) => {
  // Check if Ollama is accessible
  const ollamaUrl = process.env.LLM_ARBITRATOR_URL || 'http://localhost:11434';
  
  // For testing, we'll assume it's available if the URL is set
  res.json({
    ollama: 'available',
    model: 'llama3.2:latest',
    url: ollamaUrl,
    status: 'ready'
  });
});

/**
 * Modules status endpoint
 */
router.get('/modules', (req, res) => {
  res.json({
    ccipEventListener: true,
    ollamaLLM: true,
    evidenceValidator: true,
    ipfsClient: true,
    merkleEvidence: true,
    arbitrationService: true
  });
});

/**
 * Performance metrics endpoint
 */
router.get('/metrics', (req, res) => {
  const currentMemory = process.memoryUsage();
  
  res.json({
    uptime: Date.now() - testingData.metrics.uptime,
    requestCount: testingData.metrics.requestCount,
    memory: {
      rss: `${Math.round(currentMemory.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(currentMemory.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(currentMemory.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(currentMemory.external / 1024 / 1024)}MB`
    },
    process: {
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version
    }
  });
});

/**
 * Add CCIP request for testing
 */
router.post('/ccip/add-request', (req, res) => {
  const request = {
    id: Date.now(),
    ...req.body,
    status: 'processing',
    timestamp: new Date().toISOString()
  };
  
  testingData.requests.push(request);
  res.json(request);
});

/**
 * Add CCIP event for testing
 */
router.post('/ccip/add-event', (req, res) => {
  const event = {
    id: Date.now(),
    ...req.body,
    timestamp: new Date().toISOString()
  };
  
  testingData.events.push(event);
  res.json(event);
});

/**
 * Clear testing data
 */
router.delete('/reset', (req, res) => {
  testingData.requests = [];
  testingData.events = [];
  testingData.metrics.requestCount = 0;
  
  res.json({ message: 'Testing data cleared' });
});

export default router;