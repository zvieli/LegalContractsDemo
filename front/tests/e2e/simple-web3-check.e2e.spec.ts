import { test, expect } from '@playwright/test';
import { MetaMaskHelper } from './helpers/metamask-helper';

/**
 * V7 Simple Web3 Check Test Suite
 * Quick validation of core functionality with real wallet
 */

test.describe('V7 Simple Web3 Check', () => {
  let metaMask: MetaMaskHelper;

  test.beforeEach(async ({ page, context }) => {
    metaMask = new MetaMaskHelper(page, context);
    await metaMask.setupWallet();
    console.log('🦊 MetaMask ready for simple checks');
  });

  test('Quick V7 functionality check with Web3', async ({ page }) => {
    console.log('⚡ V7 Simple Check with Real Web3 Started');

    // Connect wallet first
    await metaMask.connectWallet();
    console.log('🔗 Wallet connected for simple check');

    // Basic page load with wallet
    console.log('\n🌐 Testing page load with connected wallet...');
    
    const homeTitle = page.locator('[data-testid="home-title"]');
    const heroSection = page.locator('[data-testid="home-hero-section"]');
    const featuresSection = page.locator('[data-testid="home-features-section"]');

    await expect(homeTitle).toBeVisible();
    await expect(heroSection).toBeVisible();
    await expect(featuresSection).toBeVisible();

    console.log('✅ Core page elements loaded with wallet');

    // Quick wallet state check
    console.log('\n💰 Testing wallet state integration...');
    
    const balance = await metaMask.getBalance();
    console.log('💰 Wallet balance:', balance);
    expect(balance).toBeDefined();

    // Check network connection
    const networkInfo = await page.evaluate(async () => {
      if ((window as any).ethereum) {
        const chainId = await (window as any).ethereum.request({ method: 'eth_chainId' });
        return { chainId };
      }
      return null;
    });
    
    console.log('🔗 Network info:', networkInfo);
    expect(networkInfo).not.toBeNull();

    // Quick admin vs user check
    console.log('\n👑 Testing user role detection...');
    
    const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
    const createContractBtn = page.locator('[data-testid="create-contract-btn"]');

    if (await adminDashboard.isVisible()) {
      console.log('👑 Admin interface detected');
      
      // Quick admin dashboard check
      const syncStatus = page.locator('[data-testid="sync-status"]');
      const summaryDai = page.locator('[data-testid="summary-dai"]');
      const summaryEth = page.locator('[data-testid="summary-eth"]');
      
      await expect(syncStatus).toBeVisible();
      await expect(summaryDai).toBeVisible();
      await expect(summaryEth).toBeVisible();
      
      console.log('✅ Admin dashboard elements validated');
      
    } else if (await createContractBtn.isVisible()) {
      console.log('👤 User interface detected');
      
      // Quick user interface check
      const browseDashboardBtn = page.locator('[data-testid="browse-contracts-btn"]');
      const contractPlaceholder = page.locator('[data-testid="contract-placeholder"]');
      
      await expect(browseDashboardBtn).toBeVisible();
      await expect(contractPlaceholder).toBeVisible();
      
      console.log('✅ User interface elements validated');
    }

    // Quick interaction test
    console.log('\n🎯 Testing quick interaction with Web3...');
    
    const interactiveElements = page.locator('button, a[href]');
    const interactiveCount = await interactiveElements.count();
    console.log(`🎮 Found ${interactiveCount} interactive elements`);
    
    expect(interactiveCount).toBeGreaterThan(0);

    // Test one quick navigation if available
    const browseDashboardBtn = page.locator('[data-testid="browse-contracts-btn"]');
    if (await browseDashboardBtn.isVisible()) {
      console.log('📱 Testing quick navigation...');
      await browseDashboardBtn.click();
      await page.waitForLoadState('networkidle');
      
      // Verify navigation worked
      const currentUrl = page.url();
      console.log('🔗 Navigated to:', currentUrl);
      
      // Go back
      await page.goBack();
      await page.waitForLoadState('networkidle');
      
      console.log('✅ Quick navigation test completed');
    }

    console.log('\n🎉 V7 Simple Check with Web3 Completed Successfully');
  });

  test('Quick Web3 transaction test', async ({ page }) => {
    console.log('💸 Quick Web3 Transaction Test');

    // Connect wallet
    await metaMask.connectWallet();
    
    // Try to trigger a simple transaction if possible
    const createContractBtn = page.locator('[data-testid="create-contract-btn"]');
    
    if (await createContractBtn.isVisible()) {
      console.log('📝 Testing contract creation transaction...');
      
      await createContractBtn.click();
      await page.waitForLoadState('networkidle');
      
      // Look for any form or transaction trigger
      const submitBtn = page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Submit")');
      
      if (await submitBtn.isVisible()) {
        console.log('💫 Found transaction trigger, testing...');
        
        // Fill any required fields quickly
        const inputs = page.locator('input[required]');
        const inputCount = await inputs.count();
        
        for (let i = 0; i < inputCount; i++) {
          const input = inputs.nth(i);
          const inputType = await input.getAttribute('type') || 'text';
          
          if (inputType === 'text') {
            await input.fill('Test Value');
          } else if (inputType === 'email') {
            await input.fill('test@example.com');
          } else if (inputType === 'number') {
            await input.fill('100');
          }
        }
        
        // Submit and handle transaction
        await submitBtn.click();
        
        try {
          // Wait for MetaMask transaction approval
          await metaMask.approveTransaction();
          console.log('✅ Transaction approved and processed');
        } catch (e) {
          console.log('⚠️ Transaction cancelled or failed:', e);
        }
        
        await page.waitForTimeout(2000);
      }
      
      // Go back to home
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
    }

    console.log('✅ Quick transaction test completed');
  });

  test('Quick responsive check with wallet', async ({ page }) => {
    console.log('📱 Quick Responsive Check with Connected Wallet');

    // Connect wallet
    await metaMask.connectWallet();
    
    // Test key breakpoints quickly
    const viewports = [
      { width: 1200, height: 800, name: 'Desktop' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 375, height: 667, name: 'Mobile' }
    ];

    for (const viewport of viewports) {
      console.log(`📱 Testing ${viewport.name} (${viewport.width}x${viewport.height})`);
      
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);

      // Quick check of key elements
      const homeTitle = page.locator('[data-testid="home-title"]');
      const heroSection = page.locator('[data-testid="home-hero-section"]');

      await expect(homeTitle).toBeVisible();
      await expect(heroSection).toBeVisible();

      console.log(`✅ ${viewport.name} layout validated with wallet`);
    }

    // Reset to desktop
    await page.setViewportSize({ width: 1200, height: 800 });

    console.log('✅ Quick responsive check completed');
  });
});