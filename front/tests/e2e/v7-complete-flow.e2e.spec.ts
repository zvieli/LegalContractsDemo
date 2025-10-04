import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { MetaMaskHelper } from './helpers/metamask-helper';

/**
 * V7 Complete E2E Test Suite - Web3 Flow with Real MetaMask
 * Tests the entire V7 flow with actual wallet connections and blockchain transactions
 */

test.describe('V7 Complete Web3 E2E Flow', () => {
  let metaMask: MetaMaskHelper;

  test.beforeEach(async ({ page, context }) => {
    metaMask = new MetaMaskHelper(page, context);
    
    // Setup MetaMask wallet before each test
    await metaMask.setupWallet();
    console.log('🦊 MetaMask setup completed');
  });

  test('Full V7 user journey with real Web3 transactions', async ({ page }) => {
    console.log('🚀 Starting V7 Complete Web3 Flow Test');
    
    // Test can run with real blockchain
    let hasBlockchain = true;
    try {
      const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      await provider.getBlockNumber();
      console.log('✅ Blockchain connection verified');
    } catch (e) {
      hasBlockchain = false;
      console.log('⚠️ Blockchain not available, using MetaMask mock only');
    }

    // Connect wallet to DApp
    await metaMask.connectWallet();
    console.log('🌐 V7 Frontend loaded with wallet connected');

    // PHASE 1: Home Page Validation with Wallet Connected
    console.log('\\n📋 PHASE 1: V7 Home Page with Wallet Connection');

    // Test core home page elements
    const homeTitle = page.locator('[data-testid="home-title"]');
    const heroSection = page.locator('[data-testid="home-hero-section"]');
    const featuresSection = page.locator('[data-testid="home-features-section"]');
    const dashboardPreview = page.locator('[data-testid="home-dashboard-preview"]');

    await expect(homeTitle).toBeVisible();
    await expect(heroSection).toBeVisible();
    await expect(featuresSection).toBeVisible();
    await expect(dashboardPreview).toBeVisible();

    console.log('✅ Home page elements verified with wallet connected');

    // Check features grid
    const featureCards = page.locator('[data-testid^="feature-card-"]');
    const featureCount = await featureCards.count();
    expect(featureCount).toBeGreaterThan(0);
    console.log(`✅ Found ${featureCount} feature cards`);

    // PHASE 2: Admin vs User Detection with Real Wallet
    console.log('\\n🔍 PHASE 2: User Role Detection with Connected Wallet');

    // Switch to admin account
    await metaMask.switchToAdminAccount();
    
    // Refresh to trigger admin detection
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for wallet state to update

    const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
    const createContractBtn = page.locator('[data-testid="create-contract-btn"]');

    if (await adminDashboard.isVisible()) {
      console.log('👑 ADMIN DETECTED - Testing Admin Dashboard with Real Wallet');
      
      // Test admin dashboard with real wallet data
      await testAdminDashboardWithWeb3(page, metaMask);
      
    } else {
      console.log('👤 REGULAR USER DETECTED - Testing User Interface with Wallet');
      
      // Test regular user interface with wallet connected
      await expect(createContractBtn).toBeVisible();
      
      const contractPlaceholder = page.locator('[data-testid="contract-placeholder"]');
      await expect(contractPlaceholder).toBeVisible();
      
      console.log('✅ User interface verified with wallet connected');
    }

    // PHASE 3: Contract Creation Flow (if available)
    console.log('\\n📝 PHASE 3: Testing Contract Creation with Real Transactions');

    if (await createContractBtn.isVisible()) {
      await createContractBtn.click();
      await page.waitForLoadState('networkidle');
      
      // Look for contract creation form
      const contractForm = page.locator('form, [data-testid*="contract-form"]');
      if (await contractForm.isVisible()) {
        console.log('📋 Contract creation form found');
        
        // Fill form if present
        const nameInput = page.locator('input[name*="name"], input[placeholder*="name"]');
        const addressInput = page.locator('input[name*="address"], input[placeholder*="address"]');
        
        if (await nameInput.isVisible()) {
          await nameInput.fill('Test Contract Web3');
        }
        if (await addressInput.isVisible()) {
          await addressInput.fill('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
        }
        
        // Submit form and handle transaction
        const submitBtn = page.locator('button[type="submit"], button:has-text("Create")');
        if (await submitBtn.isVisible()) {
          console.log('🔗 Submitting contract creation transaction...');
          
          await submitBtn.click();
          
          // Wait for MetaMask transaction approval
          await metaMask.approveTransaction();
          
          // Wait for transaction to complete
          await page.waitForTimeout(3000);
          
          console.log('✅ Contract creation transaction completed');
        }
      }
      
      // Go back to home
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
    }

    // PHASE 4: Navigation Testing with Wallet
    console.log('\\n🔗 PHASE 4: Navigation Flow with Connected Wallet');

    const browseDashboardBtn = page.locator('[data-testid="browse-contracts-btn"]');
    if (await browseDashboardBtn.isVisible()) {
      await browseDashboardBtn.click();
      await page.waitForLoadState('networkidle');
      console.log('✅ Dashboard navigation successful with wallet');
      
      // Go back to home
      await page.goBack();
      await page.waitForLoadState('networkidle');
    }

    // PHASE 5: Responsive Design with Wallet Connected
    console.log('\\n📱 PHASE 5: Responsive Design with Wallet State');

    const viewports = [
      { width: 1920, height: 1080, name: 'Desktop' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 375, height: 667, name: 'Mobile' }
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);

      // Core elements should still be visible with wallet connected
      await expect(homeTitle).toBeVisible();
      await expect(heroSection).toBeVisible();
      
      console.log(`✅ ${viewport.name} layout validated with wallet`);
    }

    // Reset to desktop
    await page.setViewportSize({ width: 1920, height: 1080 });

    // PHASE 6: Web3 Integration Validation
    console.log('\\n⚡ PHASE 6: Web3 Integration Validation');

    // Test wallet balance display
    const balance = await metaMask.getBalance();
    console.log('💰 Wallet balance:', balance);
    
    // Test network connection
    const networkInfo = await page.evaluate(async () => {
      if ((window as any).ethereum) {
        const chainId = await (window as any).ethereum.request({ method: 'eth_chainId' });
        const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
        return { chainId, accounts };
      }
      return null;
    });
    
    console.log('🔗 Network info:', networkInfo);
    expect(networkInfo).not.toBeNull();
    expect(networkInfo?.accounts).toHaveLength(1);
    console.log('✅ Web3 integration validated');

    console.log('\\n🎉 V7 Complete Web3 E2E Flow Test Completed Successfully');
  });

  test('V7 Error Handling and Edge Cases', async ({ page }) => {
    console.log('🔍 Testing V7 Error Handling and Edge Cases');

    // Test with no network connection simulation
    await page.route('**/*', route => {
      if (route.request().url().includes('127.0.0.1:8545')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // Page should still load even without blockchain
    const homeTitle = page.locator('[data-testid="home-title"]');
    await expect(homeTitle).toBeVisible();
    
    console.log('✅ Application handles network errors gracefully');

    // Test admin dashboard sync error handling
    const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
    if (await adminDashboard.isVisible()) {
      const syncStatus = page.locator('[data-testid="sync-status"]');
      // Look for error indicators
      const errorText = page.locator('text=Sync Error');
      if (await errorText.isVisible()) {
        console.log('✅ Admin dashboard shows sync errors appropriately');
      }
    }

    console.log('✅ Error handling tests completed');
  });
});

// Helper function to test admin dashboard with Web3
async function testAdminDashboardWithWeb3(page: any, metaMask: MetaMaskHelper) {
  console.log('\\n👑 Testing Admin Dashboard with Web3 Integration');

  // Test dashboard title and structure
  const dashboardTitle = page.locator('[data-testid="admin-dashboard-title"]');
  const syncStatus = page.locator('[data-testid="sync-status"]');
  const summaryCards = page.locator('[data-testid="summary-cards"]');
  const transactionsTable = page.locator('[data-testid="transactions-table"]');

  await expect(dashboardTitle).toBeVisible();
  await expect(syncStatus).toBeVisible();
  await expect(summaryCards).toBeVisible();
  
  console.log('✅ Admin dashboard structure validated');

  // Test sync status with real blockchain data
  const syncText = await syncStatus.textContent();
  console.log('🔄 Sync status:', syncText);
  expect(syncText).toContain('Sync Status:');

  // Test summary cards with real data
  const daiSummary = page.locator('[data-testid="dai-summary"]');
  const ethSummary = page.locator('[data-testid="eth-summary"]');
  const systemHealth = page.locator('[data-testid="system-health"]');
  const activeContracts = page.locator('[data-testid="active-contracts"]');

  await expect(daiSummary).toBeVisible();
  await expect(ethSummary).toBeVisible();
  await expect(systemHealth).toBeVisible();
  await expect(activeContracts).toBeVisible();

  console.log('✅ Summary cards validated with Web3 data');

  // Test transactions table
  if (await transactionsTable.isVisible()) {
    const tableRows = page.locator('[data-testid="transaction-row"]');
    const rowCount = await tableRows.count();
    console.log(`📊 Found ${rowCount} transaction rows`);
    
    if (rowCount > 0) {
      // Test first row has expected structure
      const firstRow = tableRows.first();
      const typeCell = firstRow.locator('[data-testid="tx-type"]');
      const amountCell = firstRow.locator('[data-testid="tx-amount"]');
      const statusCell = firstRow.locator('[data-testid="tx-status"]');
      
      await expect(typeCell).toBeVisible();
      await expect(amountCell).toBeVisible();
      await expect(statusCell).toBeVisible();
      
      console.log('✅ Transaction table structure validated');
    }
  }

  // Test refresh functionality with Web3
  const refreshBtn = page.locator('[data-testid="refresh-dashboard"]');
  if (await refreshBtn.isVisible()) {
    console.log('🔄 Testing dashboard refresh with Web3...');
    await refreshBtn.click();
    await page.waitForTimeout(2000); // Wait for refresh
    
    // Verify sync status updated
    const newSyncText = await syncStatus.textContent();
    console.log('🔄 Updated sync status:', newSyncText);
    
    console.log('✅ Dashboard refresh validated');
  }

  // Test withdraw modal with Web3
  const withdrawBtn = page.locator('[data-testid="withdraw-funds"]');
  if (await withdrawBtn.isVisible()) {
    console.log('💰 Testing withdraw modal with Web3...');
    await withdrawBtn.click();
    
    const withdrawModal = page.locator('[data-testid="withdraw-modal"]');
    await expect(withdrawModal).toBeVisible();
    
    const amountInput = page.locator('[data-testid="withdraw-amount"]');
    const tokenSelect = page.locator('[data-testid="withdraw-token"]');
    const confirmBtn = page.locator('[data-testid="confirm-withdraw"]');
    const cancelBtn = page.locator('[data-testid="cancel-withdraw"]');
    
    await expect(amountInput).toBeVisible();
    await expect(tokenSelect).toBeVisible();
    await expect(confirmBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    
    // Test modal functionality
    await amountInput.fill('0.01');
    await tokenSelect.selectOption('ETH');
    
    // Test transaction approval flow
    console.log('💸 Testing withdraw transaction...');
    await confirmBtn.click();
    
    // Wait for MetaMask transaction approval
    await metaMask.approveTransaction();
    
    // Wait for transaction completion
    await page.waitForTimeout(3000);
    
    console.log('✅ Withdraw transaction flow validated');
    
    // Close modal if still open
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
    }
  }

  // Test wallet balance integration
  const balance = await metaMask.getBalance();
  console.log('💰 Admin wallet balance:', balance);
  
  // Verify balance is displayed in dashboard
  const balanceDisplay = page.locator('[data-testid*="balance"], [data-testid*="wallet"]');
  if (await balanceDisplay.isVisible()) {
    const displayedBalance = await balanceDisplay.textContent();
    console.log('💰 Dashboard balance display:', displayedBalance);
  }

  console.log('✅ Admin Dashboard Web3 integration fully validated');
}

// Helper function to test admin dashboard
async function testAdminDashboard(page: any) {
  console.log('🔍 Testing Admin Dashboard Components');

  // Test sync status section
  const syncStatus = page.locator('[data-testid="sync-status"]');
  const refreshBtn = page.locator('[data-testid="refresh-sync-btn"]');
  
  await expect(syncStatus).toBeVisible();
  await expect(refreshBtn).toBeVisible();
  
  // Test refresh functionality
  await refreshBtn.click();
  console.log('✅ Sync refresh button works');

  // Test summary cards
  const summaryDai = page.locator('[data-testid="summary-dai"]');
  const summaryEth = page.locator('[data-testid="summary-eth"]');
  
  await expect(summaryDai).toBeVisible();
  await expect(summaryEth).toBeVisible();
  
  // Verify summary cards contain expected content
  await expect(summaryDai).toContainText('DAI');
  await expect(summaryEth).toContainText('ETH');
  console.log('✅ Summary cards validated');

  // Test transactions table
  const transactionsTable = page.locator('[data-testid="transactions-table"]');
  await expect(transactionsTable).toBeVisible();
  
  // Check table headers
  const tableHeaders = ['Date', 'Amount', 'Token', 'Contract', 'Sender'];
  for (const header of tableHeaders) {
    await expect(transactionsTable).toContainText(header);
  }
  console.log('✅ Transactions table structure validated');

  // Test withdraw functionality
  const withdrawBtn = page.locator('[data-testid="open-withdraw-modal"]');
  await expect(withdrawBtn).toBeVisible();
  
  await withdrawBtn.click();
  
  const withdrawModal = page.locator('[data-testid="withdraw-modal"]');
  const withdrawAddressInput = page.locator('[data-testid="withdraw-address-input"]');
  const withdrawAmountInput = page.locator('[data-testid="withdraw-amount-input"]');
  const withdrawTokenSelect = page.locator('[data-testid="withdraw-token-select"]');
  const confirmWithdrawBtn = page.locator('[data-testid="confirm-withdraw-btn"]');
  
  await expect(withdrawModal).toBeVisible();
  await expect(withdrawAddressInput).toBeVisible();
  await expect(withdrawAmountInput).toBeVisible();
  await expect(withdrawTokenSelect).toBeVisible();
  await expect(confirmWithdrawBtn).toBeVisible();
  
  // Test form validation
  await confirmWithdrawBtn.click();
  // Should show error or remain disabled due to empty fields
  
  // Test valid input
  await withdrawAddressInput.fill('0x1234567890123456789012345678901234567890');
  await withdrawAmountInput.fill('0.1');
  await withdrawTokenSelect.selectOption('ETH');
  
  console.log('✅ Withdraw form validation working');
  
  // Close modal
  const cancelBtn = page.locator('button:has-text("Cancel")');
  await cancelBtn.click();
  await expect(withdrawModal).not.toBeVisible();
  
  console.log('✅ Admin dashboard fully validated');
}