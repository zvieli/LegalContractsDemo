import { test, expect } from '@playwright/test';
import { setupMetaMask, MetaMaskHelper } from './metamask.helper';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

let metamask: MetaMaskHelper;

test.beforeAll(async () => {
  try {
    metamask = await setupMetaMask();
    
    // Add Hardhat network
    await metamask.addNetwork({
      name: 'Hardhat Local',
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: '31337',
      symbol: 'ETH'
    });
  } catch (error) {
    console.log('MetaMask setup failed, continuing with limited testing:', error);
  }
});

test.afterAll(async () => {
  if (metamask?.context) {
    await metamask.context.close();
  }
});

test('Full E2E with MetaMask Helper', async () => {
  const page = await metamask.context.newPage();
  
  // Enable console logging
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  await page.goto('http://localhost:5173');

  // Wait for page to load
  await page.waitForLoadState('networkidle');

  // Check E2E mode detection
  const e2eMode = await page.evaluate(() => {
    const hasE2E = typeof window !== 'undefined' && (window as any).__E2E_TESTING__;
    const hasEnv = typeof window !== 'undefined' && (window as any).import?.meta?.env?.VITE_E2E_TESTING;
    return { hasE2E, hasEnv, windowKeys: Object.keys(window).filter(k => k.includes('E2E') || k.includes('TEST')) };
  });
  console.log('E2E Mode detection:', e2eMode);

  // Connect wallet first - this is critical for the app to work
  await metamask.connect();
  
  // Wait and check if we need to click a connect button
  const connectButton = page.locator('button:has-text("Connect Wallet"), [data-testid="connect-wallet"]');
  if (await connectButton.isVisible()) {
    await connectButton.click();
    await page.waitForTimeout(2000);
  }

  // Navigate to home and look for the "Create New Contract" button
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  
  const createContractBtn = page.locator('[data-testid="create-contract-btn"]');
  await expect(createContractBtn).toBeVisible();
  await createContractBtn.click();
  
  // This should take us to the contract selection page (/create)
  await page.waitForURL('**/create');
  
  // Select rental contract type
  const rentCard = page.getByText('Rental Contract');
  await expect(rentCard).toBeVisible();
  await rentCard.click();
  
  // Wait for navigation to rent creation form
  await page.waitForURL('**/create-rent');
  
  // Debug: Check what's actually on the page
  const pageState = await page.evaluate(() => {
    const bodyText = document.body.textContent || '';
    const hasWalletMsg = bodyText.includes('Please connect your wallet');
    const hasForm = !!document.querySelector('form.rent-form');
    const ethersContext = (window as any).__APP_ETHERS__;
    return { hasWalletMsg, hasForm, bodyText: bodyText.substring(0, 200), ethersContext };
  });
  console.log('Page state at create-rent:', pageState);
  
  // Check if we're being asked to connect wallet on this page
  const connectWalletMessage = page.locator('text=Please connect your wallet');
  if (await connectWalletMessage.isVisible()) {
    console.log('Connect wallet message found, forcing connection...');
    
    // Force the app to think wallet is connected by manipulating React state
    await page.evaluate(async () => {
      try {
        // Force E2E mode detection
        if (typeof window !== 'undefined') {
          (window as any).__E2E_TESTING__ = true;
          console.log('🧪 Set E2E testing flag');
        }
        
        // First, ensure ethereum provider is properly set up
        if ((window as any).ethereum) {
          const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
          console.log('Accounts received:', accounts);
          
          // Force React to re-render by manipulating the DOM or triggering events
          // that React components might be listening to
          window.dispatchEvent(new Event('ethereum#initialized'));
          window.dispatchEvent(new CustomEvent('accountsChanged', { detail: accounts }));
          
          // Also try to force a page refresh of React state
          if ((window as any).__APP_ETHERS__) {
            console.log('Found app ethers state:', (window as any).__APP_ETHERS__);
          }

          // Give React some time to process the state change
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.log('Manual connection error:', error);
      }
    });
    
    // Wait longer for React to update
    await page.waitForTimeout(5000);
    
    // Check if wallet message is still there
    const stillNeedsWallet = await connectWalletMessage.isVisible();
    if (stillNeedsWallet) {
      console.log('Wallet connection failed, trying to force form to appear...');
      
      // As a last resort, try to inject the form HTML directly
      await page.evaluate(() => {
        const walletDiv = document.querySelector('body');
        if (walletDiv && walletDiv.textContent?.includes('Please connect your wallet')) {
          console.log('Attempting to force form visibility by removing wallet check');
          // This is a hack for testing - just reload the page
          window.location.reload();
        }
      });
      
      await page.waitForTimeout(3000);
    }
  }
  
  // Wait for the form to appear or check what's on the page
  const formExists = await page.locator('form.rent-form').isVisible().catch(() => false);
  if (!formExists) {
    console.log('Form not found, checking page content...');
    const pageContent = await page.textContent('body');
    console.log('Page content:', pageContent?.substring(0, 500));
  }
  
  // Fill contract form (should work now that wallet is connected)
  await expect(page.locator('form.rent-form')).toBeVisible();
  await page.locator('input[name="tenantAddress"]').fill('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  await page.locator('input[name="rentAmount"]').fill('1.5');
  await page.locator('input[name="duration"]').fill('30');
  await page.locator('input[name="startDate"]').fill('2025-10-07');
  
  // Deploy contract - MetaMask should handle transaction approval
  await page.locator('button[data-testid="button-deploy-contract"]').click();
  
  // Wait for contract deployment confirmation
  const contractInfo = page.locator('.created-contract-info');
  await expect(contractInfo).toBeVisible({ timeout: 30000 });

  // Test evidence upload
  const evidenceInput = page.locator('textarea[data-testid="evidence-input"]');
  await expect(evidenceInput).toBeVisible();
  await evidenceInput.fill('{"note":"E2E test evidence with MetaMask helper"}');
  
  const evidenceSubmitBtn = page.locator('button[data-testid="evidence-submit-btn"]');
  await expect(evidenceSubmitBtn).toBeVisible();
  await evidenceSubmitBtn.click();

  // Verify evidence table update
  const evidenceTable = page.locator('table.evidence, [data-testid="evidence-table"]');
  await expect(evidenceTable).toBeVisible();
  
  const row = evidenceTable.locator('tbody tr').last();
  await expect(row.locator('td[data-testid="filename"]')).not.toBeEmpty();
  await expect(row.locator('td[data-testid="cid"]')).not.toBeEmpty();
});

test('should display LLM arbitration decisions', async () => {
  const page = await metamask.context.newPage();
  
  // Navigate to arbitration page for a test dispute
  await page.goto('http://localhost:5173/arbitration/test-dispute-789');
  await page.waitForLoadState('networkidle');

  // Connect wallet if needed
  await metamask.connect();
  const connectButton = page.locator('button:has-text("Connect Wallet")');
  if (await connectButton.isVisible()) {
    await connectButton.click();
    await page.waitForTimeout(2000);
  }

  // Check for LLM decision display
  const decisionView = page.locator('[data-testid="llm-decision-view"], .llm-decision-view');
  await expect(decisionView).toBeVisible();

  // Verify decision content structure
  const verdictElement = decisionView.locator('[data-testid="verdict"], .verdict');
  const reasoningElement = decisionView.locator('[data-testid="reasoning"], .reasoning');
  const confidenceElement = decisionView.locator('[data-testid="confidence"], .confidence');

  // At least one of these should be visible
  const hasVerdict = await verdictElement.isVisible().catch(() => false);
  const hasReasoning = await reasoningElement.isVisible().catch(() => false);
  const hasConfidence = await confidenceElement.isVisible().catch(() => false);

  expect(hasVerdict || hasReasoning || hasConfidence).toBe(true);

  // If verdict is displayed, verify it's valid
  if (hasVerdict) {
    const verdictText = await verdictElement.textContent();
    const validVerdicts = ['PARTY_A_WINS', 'PARTY_B_WINS', 'NO_PENALTY', 'DRAW'];
    expect(validVerdicts.some(v => verdictText?.includes(v))).toBe(true);
  }
});

test('should sync with backend arbitration status', async () => {
  const page = await metamask.context.newPage();
  
  // Navigate to arbitration dashboard
  await page.goto('http://localhost:5173/arbitration');
  await page.waitForLoadState('networkidle');

  // Connect wallet if needed
  await metamask.connect();
  const connectButton = page.locator('button:has-text("Connect Wallet")');
  if (await connectButton.isVisible()) {
    await connectButton.click();
    await page.waitForTimeout(2000);
  }

  // Check arbitration status display
  const statusContainer = page.locator('[data-testid="arbitration-status-container"], .arbitration-status');
  await expect(statusContainer).toBeVisible();

  // Verify status indicators
  const statusIndicators = [
    'pending',
    'processing', 
    'completed',
    'failed'
  ];

  let foundStatus = false;
  for (const status of statusIndicators) {
    const statusElement = statusContainer.locator(`[data-status="${status}"], .status-${status}`);
    if (await statusElement.isVisible().catch(() => false)) {
      foundStatus = true;
      break;
    }
  }
  expect(foundStatus).toBe(true);

  // Check decisions history
  const historyContainer = page.locator('[data-testid="decisions-history"], .decisions-history');
  await expect(historyContainer).toBeVisible();

  // Verify history has entries or shows empty state appropriately
  const historyEntries = historyContainer.locator('.decision-entry, tr, .history-item');
  const entryCount = await historyEntries.count();
  
  if (entryCount > 0) {
    // If there are entries, verify they have required fields
    const firstEntry = historyEntries.first();
    const disputeId = await firstEntry.locator('[data-testid="dispute-id"], .dispute-id').textContent();
    expect(disputeId).toBeTruthy();
  }
});

test('should validate contract events in UI', async () => {
  const page = await metamask.context.newPage();
  
  // Navigate to contract management page
  await page.goto('http://localhost:5173/contracts');
  await page.waitForLoadState('networkidle');

  // Connect wallet if needed
  await metamask.connect();
  const connectButton = page.locator('button:has-text("Connect Wallet")');
  if (await connectButton.isVisible()) {
    await connectButton.click();
    await page.waitForTimeout(2000);
  }

  // Check for contract event display
  const eventsContainer = page.locator('[data-testid="contract-events"], .contract-events');
  await expect(eventsContainer).toBeVisible();

  // Verify expected event types are displayed
  const eventTypes = [
    'DisputeAppliedCapped',
    'ResolutionApplied', 
    'BreachReported',
    'EvidenceSubmitted'
  ];

  let foundEvent = false;
  for (const eventType of eventTypes) {
    const eventElement = eventsContainer.locator(`[data-event-type="${eventType}"], .event-${eventType.toLowerCase()}`);
    if (await eventElement.isVisible().catch(() => false)) {
      foundEvent = true;
      
      // Verify event has required data
      const eventData = await eventElement.locator('[data-testid="event-data"], .event-data').textContent();
      expect(eventData).toBeTruthy();
      break;
    }
  }

  // If no specific events found, at least verify events container has content
  if (!foundEvent) {
    const eventContent = await eventsContainer.textContent();
    expect(eventContent?.trim().length).toBeGreaterThan(0);
  }

  // Check dispute status display
  const disputeStatus = page.locator('[data-testid="dispute-status"], .dispute-status');
  if (await disputeStatus.isVisible().catch(() => false)) {
    const statusText = await disputeStatus.textContent();
    const validStatuses = ['active', 'resolved', 'pending', 'closed'];
    expect(validStatuses.some(s => statusText?.toLowerCase().includes(s))).toBe(true);
  }
});
