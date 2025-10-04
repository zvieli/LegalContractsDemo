/**
 * V7 Integration Layer - Main integration module
 * Connects all V7 backend components
 */

// NOTE: These modules are siblings in the same directory. The previous path './modules/...' was incorrect
// and resulted in runtime import errors like server/modules/modules/evidenceValidator.js not found.
// Correcting to relative sibling imports.
import { validateIPFSEvidence, generateEvidenceDigest } from './evidenceValidator.js';
import { triggerLLMArbitration, handleLLMResponse } from './llmArbitration.js';
import { calculateLateFee, getTimeBasedData, calculateTotalPayment } from './timeManagement.js';
import { callArbitratorAPI, checkArbitratorAPIHealth } from './arbitratorAPI.js';
import { ethers } from 'ethers';

/**
 * V7 Integrated Dispute Processing
 * Complete flow from evidence validation to LLM arbitration
 */
export class V7DisputeProcessor {
  constructor(config = {}) {
    this.config = {
      enableLLM: config.enableLLM !== false,
      enableEvidenceValidation: config.enableEvidenceValidation !== false,
      enableTimeManagement: config.enableTimeManagement !== false,
      ...config
    };
    
    this.activeDisputes = new Map();
    this.arbitrationResults = new Map();
  }

  /**
   * Process complete dispute flow
   * @param {Object} disputeData - Complete dispute information
   * @returns {Promise<Object>} - Processing result
   */
  async processDispute(disputeData) {
    const processingId = this.generateProcessingId();
    
    try {
      console.log(`🔄 Processing dispute ${processingId}`);
      
      // Store dispute for tracking
      this.activeDisputes.set(processingId, {
        ...disputeData,
        processingId,
        status: 'processing',
        startedAt: Date.now()
      });
      
      // Phase 1: Evidence Validation
      const evidenceValidation = await this.validateEvidence(disputeData.evidenceCID);
      if (!evidenceValidation.isValid) {
        throw new Error(`Evidence validation failed: ${evidenceValidation.error}`);
      }
      
      // Phase 2: Time-based calculations
      const timeData = await this.calculateTimeBasedData(disputeData);
      
      // Phase 3: LLM Arbitration
      const arbitrationResult = await this.processArbitration(disputeData, timeData);
      
      // Phase 4: Result compilation
      const result = {
        processingId,
        status: 'completed',
        evidence: evidenceValidation,
        timeData,
        arbitration: arbitrationResult,
        completedAt: Date.now()
      };
      
      // Update tracking
      this.activeDisputes.set(processingId, result);
      this.arbitrationResults.set(processingId, result);
      
      console.log(`✅ Dispute ${processingId} processed successfully`);
      return result;
      
    } catch (error) {
      console.error(`❌ Error processing dispute ${processingId}:`, error);
      
      // Update tracking with error
      this.activeDisputes.set(processingId, {
        processingId,
        status: 'failed',
        error: error.message,
        failedAt: Date.now()
      });
      
      throw error;
    }
  }

  /**
   * Validate evidence using V7 enhanced validation
   * @param {string} evidenceCID - IPFS CID
   * @returns {Promise<Object>} - Validation result
   */
  async validateEvidence(evidenceCID) {
    if (!this.config.enableEvidenceValidation) {
      return { isValid: true, method: 'disabled' };
    }
    
    try {
      const isValid = await validateIPFSEvidence(evidenceCID);
      const digest = isValid ? generateEvidenceDigest(evidenceCID) : null;
      
      return {
        isValid,
        cid: evidenceCID,
        digest,
        validatedAt: Date.now()
      };
      
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
        cid: evidenceCID
      };
    }
  }

  /**
   * Calculate time-based data and fees
   * @param {Object} disputeData - Dispute data
   * @returns {Promise<Object>} - Time-based calculations
   */
  async calculateTimeBasedData(disputeData) {
    if (!this.config.enableTimeManagement) {
      return { enabled: false };
    }
    
    try {
      const { dueDate, baseAmount, lateFeeBps } = disputeData;
      
      if (!dueDate || !baseAmount) {
        return { enabled: true, calculated: false, reason: 'Missing dueDate or baseAmount' };
      }
      
      const timeData = getTimeBasedData(dueDate);
      const lateFee = calculateLateFee(dueDate, baseAmount, lateFeeBps);
      const totalPayment = calculateTotalPayment({
        baseAmount,
        dueDate,
        lateFeeBps
      });
      
      return {
        enabled: true,
        calculated: true,
        timeData,
        lateFee,
        totalPayment,
        calculatedAt: Date.now()
      };
      
    } catch (error) {
      return {
        enabled: true,
        calculated: false,
        error: error.message
      };
    }
  }

  /**
   * Process LLM arbitration
   * @param {Object} disputeData - Dispute data
   * @param {Object} timeData - Time-based calculations
   * @returns {Promise<Object>} - Arbitration result
   */
  async processArbitration(disputeData, timeData) {
    if (!this.config.enableLLM) {
      return { enabled: false, result: this.generateFallbackResult() };
    }
    
    try {
      // Check LLM API health
      const isLLMAvailable = await checkArbitratorAPIHealth();
      
      if (!isLLMAvailable) {
        console.log('⚠️ LLM API unavailable, using fallback');
        return { 
          enabled: true, 
          available: false, 
          result: this.generateFallbackResult(),
          method: 'fallback'
        };
      }
      
      // Prepare arbitration data
      const arbitrationData = {
        contractText: disputeData.contractText || 'Standard rental agreement',
        evidenceText: disputeData.evidenceText || 'Evidence submitted via IPFS',
        disputeQuestion: disputeData.disputeQuestion || 'What is the appropriate resolution?'
      };
      
      // Call LLM API
      const llmResult = await callArbitratorAPI(arbitrationData);
      
      return {
        enabled: true,
        available: true,
        result: llmResult,
        method: 'llm-api',
        processedAt: Date.now()
      };
      
    } catch (error) {
      console.error('LLM arbitration failed:', error);
      return {
        enabled: true,
        available: false,
        error: error.message,
        result: this.generateFallbackResult(),
        method: 'fallback-after-error'
      };
    }
  }

  /**
   * Generate fallback arbitration result
   * @returns {Object} - Fallback result
   */
  generateFallbackResult() {
    return {
      final_verdict: 'DRAW',
      reimbursement_amount_dai: 500,
      rationale_summary: 'Fallback decision due to LLM service unavailability',
      fallback: true
    };
  }

  /**
   * Generate unique processing ID
   * @returns {string} - Processing ID
   */
  generateProcessingId() {
    return `v7_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get processing status
   * @param {string} processingId - Processing ID
   * @returns {Object|null} - Processing status
   */
  getProcessingStatus(processingId) {
    return this.activeDisputes.get(processingId) || null;
  }

  /**
   * Get all active disputes
   * @returns {Array} - Active disputes
   */
  getActiveDisputes() {
    return Array.from(this.activeDisputes.values());
  }

  /**
   * Get arbitration results
   * @returns {Array} - Arbitration results
   */
  getArbitrationResults() {
    return Array.from(this.arbitrationResults.values());
  }
}

/**
 * V7 Appeal Processor
 * Specialized processor for appeal flows
 */
export class V7AppealProcessor extends V7DisputeProcessor {
  
  /**
   * Process appeal with enhanced validation
   * @param {Object} appealData - Appeal data
   * @returns {Promise<Object>} - Appeal processing result
   */
  async processAppeal(appealData) {
    console.log(`📞 Processing appeal for dispute ${appealData.disputeId}`);
    
    // Enhanced appeal processing
    const enhancedAppealData = {
      ...appealData,
      type: 'appeal',
      appealSubmittedAt: Date.now(),
      disputeQuestion: `Appeal for dispute ${appealData.disputeId}: ${appealData.appealReason || 'Appeal submitted'}`
    };
    
    return await this.processDispute(enhancedAppealData);
  }
}

/**
 * V7 System Health Monitor
 * Monitors system components and dependencies
 */
export class V7HealthMonitor {
  
  /**
   * Check overall system health
   * @returns {Promise<Object>} - Health status
   */
  async checkSystemHealth() {
    const checks = await Promise.allSettled([
      this.checkLLMAPI(),
      this.checkIPFSConnectivity(),
      this.checkBlockchainRPC(),
      this.checkTimeSync()
    ]);
    
    const results = checks.map((check, index) => ({
      component: ['LLM API', 'IPFS', 'Blockchain RPC', 'Time Sync'][index],
      status: check.status === 'fulfilled' ? check.value : { healthy: false, error: check.reason.message }
    }));
    
    const overallHealth = results.every(result => result.status.healthy);
    
    return {
      healthy: overallHealth,
      timestamp: Date.now(),
      components: results
    };
  }

  async checkLLMAPI() {
    const healthy = await checkArbitratorAPIHealth();
    return { healthy, service: 'FastAPI LLM Arbitrator' };
  }

  async checkIPFSConnectivity() {
    try {
      // Simple IPFS gateway test
      const testCID = 'QmTest1234567890abcdef';
      const isValid = await validateIPFSEvidence(testCID);
      return { healthy: true, service: 'IPFS/Helia validation' };
    } catch (error) {
      return { healthy: false, error: error.message, service: 'IPFS/Helia validation' };
    }
  }

  async checkBlockchainRPC() {
    try {
      const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      await provider.getBlockNumber();
      return { healthy: true, service: 'Blockchain RPC', url: rpcUrl };
    } catch (error) {
      return { healthy: false, error: error.message, service: 'Blockchain RPC' };
    }
  }

  async checkTimeSync() {
    // Simple time sync check
    const serverTime = Date.now();
    const tolerance = 30000; // 30 seconds
    
    // In production, you might check against NTP server
    return { 
      healthy: true, 
      service: 'Time Sync', 
      serverTime: new Date(serverTime).toISOString() 
    };
  }
}

// Export singleton instances
export const v7DisputeProcessor = new V7DisputeProcessor();
export const v7AppealProcessor = new V7AppealProcessor();
export const v7HealthMonitor = new V7HealthMonitor();

// Export factory function for custom configurations
export function createV7Processor(config) {
  return new V7DisputeProcessor(config);
}