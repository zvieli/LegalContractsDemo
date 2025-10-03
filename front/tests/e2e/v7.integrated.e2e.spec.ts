/**
 * V7 Integrated E2E Test for LLM & Helia Features
 * Tests the complete V7 flow with integrated arbitration simulator
 */

import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import fetch from 'node-fetch';

const AUDIT_LOG = '../../evidence_storage/e2e_v7_integrated.json';
const V7_SERVER = 'http://localhost:3001';

interface ArbitrationResult {
  success: boolean;
  final_verdict: string;
  reimbursement_amount_dai: number;
  rationale_summary: string;
  simulation?: boolean;
}

interface ArbitrationData {
  contract_text: string;
  evidence_text: string;
  dispute_question: string;
  requested_amount: number;
}

interface HealthResponse {
  status: string;
  healthy?: boolean;
  stats?: {
    mode: string;
    responseTime: number;
    health: string;
    version: string;
  };
}

async function logAudit(caseName: string, data: any): Promise<void> {
  let log: any[] = [];
  try { 
    if (fs.existsSync(AUDIT_LOG)) {
      log = JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8')); 
    }
  } catch (error: any) {
    console.warn('Could not read audit log:', error?.message || error);
  }
  
  log.push({ 
    case: caseName, 
    timestamp: new Date().toISOString(),
    ...data 
  });
  
  try {
    fs.writeFileSync(AUDIT_LOG, JSON.stringify(log, null, 2));
  } catch (error: any) {
    console.error('Could not write audit log:', error?.message || error);
  }
}

async function testV7ArbitrationAPI(testData: ArbitrationData): Promise<ArbitrationResult> {
  try {
    const response = await fetch(`${V7_SERVER}/api/v7/arbitration/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json() as ArbitrationResult;
  } catch (error) {
    console.error('V7 API test failed:', error);
    throw error;
  }
}

test.describe('V7 Integrated LLM & Helia E2E Tests', () => {
  test.beforeAll(async () => {
    // Verify V7 server is running
    try {
      const response = await fetch(`${V7_SERVER}/health`);
      const health = await response.json() as HealthResponse;
      expect(health.status).toBe('OK');
      console.log('✅ V7 Server health check passed');
    } catch (error) {
      throw new Error('V7 Server not available. Please start with: node server/index.js');
    }
  });

  test('CASE 1: Bank Error Late Fee Dispute - Tenant Wins', async ({ page }) => {
    const caseName = 'BANK_ERROR_LATE_FEE';
    
    try {
      // Test V7 arbitration API directly
      const arbitrationData = {
        contract_text: "Rental Agreement: Monthly rent $1000 due by 5th. Late fee 5% applies after grace period.",
        evidence_text: "Bank error occurred on payment date. Transaction delayed due to processing failure on landlord's bank side. Payment receipt shows attempted transfer on time.",
        dispute_question: "Should tenant pay late fee when bank error caused the delay?",
        requested_amount: 50
      };

      const arbitrationResult = await testV7ArbitrationAPI(arbitrationData);
      
      // Verify arbitration result
      expect(arbitrationResult.success).toBe(true);
      expect(arbitrationResult.final_verdict).toBe('PARTY_A_WINS'); // Tenant wins
      expect(arbitrationResult.reimbursement_amount_dai).toBe(0);
      expect(arbitrationResult.rationale_summary).toContain('Bank error');

      // Log audit
      await logAudit(caseName, {
        status: 'SUCCESS',
        verdict: arbitrationResult.final_verdict,
        amount: arbitrationResult.reimbursement_amount_dai,
        rationale: arbitrationResult.rationale_summary,
        arbitrationData
      });

      console.log(`✅ ${caseName}: Tenant wins (no late fee due to bank error)`);

    } catch (error) {
      await logAudit(caseName, { status: 'FAILED', error: error.message });
      throw error;
    }
  });

  test('CASE 2: Water Damage Compensation - Tenant Wins', async ({ page }) => {
    const caseName = 'WATER_DAMAGE_COMPENSATION';
    
    try {
      const arbitrationData = {
        contract_text: "Rental Agreement: Landlord responsible for maintenance and repairs. Tenant liable for damages caused by negligence.",
        evidence_text: "Water damage occurred due to burst pipe in apartment. Photos show extensive damage to personal belongings. Maintenance request was filed 2 weeks prior but ignored.",
        dispute_question: "Is landlord liable for water damage compensation?",
        requested_amount: 200
      };

      const arbitrationResult = await testV7ArbitrationAPI(arbitrationData);
      
      expect(arbitrationResult.success).toBe(true);
      expect(arbitrationResult.final_verdict).toBe('PARTY_A_WINS'); // Tenant wins
      expect(arbitrationResult.reimbursement_amount_dai).toBe(200);
      expect(arbitrationResult.rationale_summary).toContain('Water damage');

      await logAudit(caseName, {
        status: 'SUCCESS',
        verdict: arbitrationResult.final_verdict,
        amount: arbitrationResult.reimbursement_amount_dai,
        rationale: arbitrationResult.rationale_summary,
        arbitrationData
      });

      console.log(`✅ ${caseName}: Tenant wins compensation for water damage`);

    } catch (error) {
      await logAudit(caseName, { status: 'FAILED', error: error.message });
      throw error;
    }
  });

  test('CASE 3: Payment Dispute with Evidence - Tenant Wins', async ({ page }) => {
    const caseName = 'PAYMENT_DISPUTE_WITH_RECEIPT';
    
    try {
      const arbitrationData = {
        contract_text: "Monthly rent $800 due by 1st of each month. Late payment incurs penalties.",
        evidence_text: "Payment receipt attached showing transfer completed on time. Bank confirmation number: TX123456789. Payment processed successfully on due date.",
        dispute_question: "Landlord claims payment was not received, but tenant has receipt. Who is correct?",
        requested_amount: 0
      };

      const arbitrationResult = await testV7ArbitrationAPI(arbitrationData);
      
      expect(arbitrationResult.success).toBe(true);
      expect(arbitrationResult.final_verdict).toBe('PARTY_A_WINS'); // Tenant wins
      expect(arbitrationResult.reimbursement_amount_dai).toBe(0);
      expect(arbitrationResult.rationale_summary).toContain('Payment evidence');

      await logAudit(caseName, {
        status: 'SUCCESS',
        verdict: arbitrationResult.final_verdict,
        amount: arbitrationResult.reimbursement_amount_dai,
        rationale: arbitrationResult.rationale_summary,
        arbitrationData
      });

      console.log(`✅ ${caseName}: Tenant wins with payment evidence`);

    } catch (error) {
      await logAudit(caseName, { status: 'FAILED', error: error.message });
      throw error;
    }
  });

  test('CASE 4: Unpaid Rent Dispute - Landlord Wins', async ({ page }) => {
    const caseName = 'UNPAID_RENT_LANDLORD_WINS';
    
    try {
      const arbitrationData = {
        contract_text: "Monthly rent $1200 due by 1st. No payment received for 2 months.",
        evidence_text: "No payment receipts provided by tenant. Bank statements show no outgoing transfers to landlord account during disputed months.",
        dispute_question: "Tenant claims payments were made but provides no evidence. Is payment due?",
        requested_amount: 2400
      };

      const arbitrationResult = await testV7ArbitrationAPI(arbitrationData);
      
      expect(arbitrationResult.success).toBe(true);
      expect(arbitrationResult.final_verdict).toBe('PARTY_B_WINS'); // Landlord wins
      expect(arbitrationResult.reimbursement_amount_dai).toBeGreaterThan(0);
      expect(arbitrationResult.rationale_summary).toContain('No payment evidence');

      await logAudit(caseName, {
        status: 'SUCCESS',
        verdict: arbitrationResult.final_verdict,
        amount: arbitrationResult.reimbursement_amount_dai,
        rationale: arbitrationResult.rationale_summary,
        arbitrationData
      });

      console.log(`✅ ${caseName}: Landlord wins - payment due`);

    } catch (error) {
      await logAudit(caseName, { status: 'FAILED', error: error.message });
      throw error;
    }
  });

  test('CASE 5: V7 Health & Performance Check', async ({ page }) => {
    const caseName = 'V7_SYSTEM_HEALTH';
    
    try {
      // Test health endpoint
      const healthResponse = await fetch(`${V7_SERVER}/api/v7/arbitration/health`);
      const healthData = await healthResponse.json() as HealthResponse;
      
      expect(healthData.healthy).toBe(true);
      expect(healthData.stats?.mode).toBe('simulation');
      
      // Measure response time
      const startTime = Date.now();
      await testV7ArbitrationAPI({
        contract_text: "Test contract",
        evidence_text: "Test evidence",
        dispute_question: "Test question",
        requested_amount: 0
      });
      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(5000); // Should complete within 5 seconds

      await logAudit(caseName, {
        status: 'SUCCESS',
        health: healthData,
        responseTime: `${responseTime}ms`,
        performance: responseTime < 3000 ? 'EXCELLENT' : 'GOOD'
      });

      console.log(`✅ ${caseName}: System healthy, response time ${responseTime}ms`);

    } catch (error: any) {
      await logAudit(caseName, { status: 'FAILED', error: error?.message || error });
      throw error;
    }
  });

});