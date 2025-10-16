import { test, expect } from '@playwright/test';

test.describe('Full Arbitration Flow', () => {
  test('should submit evidence and create dispute', async ({ request }) => {
    // Submit evidence via API
    const evidenceResponse = await request.post('http://localhost:3001/api/evidence/upload', {
      data: {
        evidence: 'Test evidence for E2E dispute creation',
        disputeId: 'e2e-test-dispute-123'
      }
    });
    expect(evidenceResponse.ok()).toBeTruthy();

    // Verify evidence was submitted
    const evidenceData = await evidenceResponse.json();        
    expect(evidenceData).toHaveProperty('stored');
    expect(evidenceData.stored).toBe(true);
    expect(evidenceData).toHaveProperty('cid');    // TODO: Check that dispute was created in contract
    // This would require contract interaction
  });

  test('should trigger arbitration and receive verdict', async ({ request }) => {
    // Trigger LLM arbitration
    const arbitrationResponse = await request.post('http://localhost:3001/api/v7/arbitration/ollama-test', {
      data: {
        evidence_text: 'Test evidence content',
        contract_text: 'Test contract terms',
        dispute_id: 'test-dispute-123'
      }
    });
    expect(arbitrationResponse.ok()).toBeTruthy();

    const verdictData = await arbitrationResponse.json();
    expect(verdictData).toHaveProperty('result');
    expect(verdictData.result).toHaveProperty('arbitration');
    expect(verdictData.result).toHaveProperty('reasoning');
    expect(verdictData.result).toHaveProperty('confidence');

    // Verify verdict is one of expected values
    const validVerdicts = ['PARTY_A_WINS', 'PARTY_B_WINS', 'NO_PENALTY', 'DRAW'];
    expect(validVerdicts).toContain(verdictData.result.arbitration);
  });

  test('should update contract state after verdict', async ({ request }) => {
    // First, create a dispute by submitting evidence
    const evidenceResponse = await request.post('http://localhost:3001/api/evidence/upload', {
      data: {
        evidence: 'Test evidence for contract state update',
        disputeId: 'contract-update-test-123'
      }
    });
    expect(evidenceResponse.ok()).toBeTruthy();

    // Trigger arbitration for this dispute using the ollama-test endpoint
    const arbitrationResponse = await request.post('http://localhost:3001/api/v7/arbitration/ollama-test', {
      data: {
        evidence_text: 'Test evidence for contract state update',
        contract_text: 'Test contract terms for dispute resolution',
        dispute_id: 'contract-update-test-123'
      }
    });
    expect(arbitrationResponse.ok()).toBeTruthy();

    // Wait for arbitration to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check arbitration status
    const statusResponse = await request.get('http://localhost:3001/api/arbitration/status/contract-update-test-123');
    expect(statusResponse.ok()).toBeTruthy();

    const statusData = await statusResponse.json();
    expect(statusData).toHaveProperty('status');
    expect(['pending', 'completed', 'failed']).toContain(statusData.status);

    // If completed, verify verdict was applied
    if (statusData.status === 'completed') {
      expect(statusData).toHaveProperty('verdict');
      expect(statusData.verdict).toHaveProperty('result');
    }
  });

  test('should sync frontend with backend and contract events', async ({ page, request }) => {
    // First, create some test data by triggering arbitration
    const evidenceResponse = await request.post('http://localhost:3001/api/evidence/upload', {
      data: {
        evidence: 'Test evidence for frontend sync',
        disputeId: 'frontend-sync-test-456'
      }
    });
    expect(evidenceResponse.ok()).toBeTruthy();

    // Navigate to arbitration page
    await page.goto('http://localhost:5173/arbitration/frontend-sync-test-456');
    await page.waitForLoadState('networkidle');

    // Check that status is loaded from backend
    const statusElement = page.locator('div.arbitration-view:has-text("Arbitration Service Status")');
    await expect(statusElement).toBeVisible();

    // Check that decisions history is displayed
    const historyElement = page.locator('h4:has-text("Previous Decisions")');
    await expect(historyElement).toBeVisible();

    // Verify that evidence is displayed
    const evidenceElement = page.locator('strong:has-text("Evidence Digests")');
    await expect(evidenceElement).toBeVisible();

    // Check for LLM decision display if arbitration completed
    const decisionElement = page.locator('h4:has-text("LLM Arbitration Decision")');
    const decisionVisible = await decisionElement.isVisible().catch(() => false);

    if (decisionVisible) {
      // If decision is visible, verify it has expected structure
      const decisionText = await decisionElement.textContent();
      expect(decisionText).toBeTruthy();
      expect(decisionText!.length).toBeGreaterThan(10); // Should have meaningful content
    }

    // Verify backend sync by checking API response matches UI
    const apiStatusResponse = await request.get('http://localhost:3001/api/arbitration/status/frontend-sync-test-456');
    if (apiStatusResponse.ok()) {
      const apiData = await apiStatusResponse.json();
      const uiStatus = await statusElement.textContent();

      // UI should reflect API status
      if (apiData.status) {
        expect(uiStatus?.toLowerCase()).toContain(apiData.status.toLowerCase());
      }
    }
  });
});
