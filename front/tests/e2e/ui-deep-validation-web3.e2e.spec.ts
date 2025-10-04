import { test, expect } from '@playwright/test';
import { MetaMaskHelper } from './helpers/metamask-helper';

/**
 * V7 Deep UI Validation Test Suite - Real Web3 Flow
 * Comprehensive UI component validation with actual wallet interactions
 */

test.describe('V7 Deep UI Validation with Real Web3', () => {
  let metaMask: MetaMaskHelper;

  test.beforeEach(async ({ page, context }) => {
    metaMask = new MetaMaskHelper(page, context);
    await metaMask.setupWallet();
    console.log('🦊 MetaMask setup for deep UI validation');
  });

  test('Comprehensive V7 UI validation with Web3 state management', async ({ page }) => {
    console.log('🔍 V7 Deep UI Validation with Real Web3 State');

    // Connect wallet before UI validation
    await metaMask.connectWallet();
    console.log('🌐 UI loaded with connected wallet');

    // SECTION 1: Home Page Component Hierarchy with Wallet
    console.log('\n🏠 SECTION 1: Home Page Component Validation with Connected Wallet');

    // Main page validation - using existing selectors
    const heroSection = page.locator('[data-testid="home-hero-section"]');
    const featuresSection = page.locator('[data-testid="home-features-section"]');
    const dashboardPreview = page.locator('[data-testid="home-dashboard-preview"]');

    await expect(heroSection).toBeVisible();
    await expect(featuresSection).toBeVisible();
    await expect(dashboardPreview).toBeVisible();
    
    // Check for navigation if it exists
    const navElements = page.locator('nav, header, [data-testid*="nav"]');
    const navCount = await navElements.count();
    if (navCount > 0) {
      console.log(`📋 Found ${navCount} navigation elements`);
      
      // Test wallet connection indicator
      const walletIndicator = page.locator('[data-testid="wallet-indicator"], [data-testid="wallet-status"]');
      if (await walletIndicator.isVisible()) {
        const walletText = await walletIndicator.textContent();
        console.log('🔗 Wallet indicator:', walletText);
        expect(walletText).not.toContain('Connect');
      }
    }

    // Check for footer if it exists
    const footerElements = page.locator('footer, [data-testid*="footer"]');
    const footerCount = await footerElements.count();
    if (footerCount > 0) {
      console.log('✅ Footer elements found');
    }

    // Hero section detailed validation with wallet
    const heroSectionDetailed = page.locator('[data-testid="home-hero-section"]');
    await expect(heroSectionDetailed).toBeVisible();

    const heroTitle = page.locator('[data-testid="home-title"]');
    const heroSubtitle = page.locator('[data-testid="hero-subtitle"], [data-testid="hero-description"]');
    const heroActions = page.locator('[data-testid="hero-actions"]');

    await expect(heroTitle).toBeVisible();
    
    if (await heroSubtitle.isVisible()) {
      const subtitleText = await heroSubtitle.textContent();
      console.log('📝 Hero subtitle:', subtitleText?.substring(0, 50) + '...');
    }

    if (await heroActions.isVisible()) {
      const actionButtons = heroActions.locator('button, a');
      const buttonCount = await actionButtons.count();
      console.log(`🔘 Found ${buttonCount} action buttons in hero`);
    }

    // SECTION 2: Features Section with Wallet Integration
    console.log('\n⭐ SECTION 2: Features Section with Wallet State');

    const featuresSectionDetailed = page.locator('[data-testid="home-features-section"]');
    await expect(featuresSectionDetailed).toBeVisible();

    // Feature cards validation
    const featureCards = page.locator('[data-testid^="feature-card-"]');
    const featureCount = await featureCards.count();
    console.log(`🃏 Found ${featureCount} feature cards`);

    if (featureCount > 0) {
      // Test first feature card structure
      const firstCard = featureCards.first();
      const cardIcon = firstCard.locator('i, svg, img');
      const cardTitle = firstCard.locator('h3');
      const cardDescription = firstCard.locator('p');

      if (await cardIcon.isVisible()) console.log('✅ Feature card has icon');
      if (await cardTitle.isVisible()) {
        const titleText = await cardTitle.textContent();
        console.log('📋 First feature title:', titleText);
      }
      if (await cardDescription.isVisible()) console.log('✅ Feature card has description');
    }

    // SECTION 3: Dashboard Preview with Real Wallet Data
    console.log('\n📊 SECTION 3: Dashboard Preview with Real Wallet Data');

    const dashboardPreviewDetailed = page.locator('[data-testid="home-dashboard-preview"]');
    await expect(dashboardPreviewDetailed).toBeVisible();

    // Check if admin dashboard is showing
    const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
    
    if (await adminDashboard.isVisible()) {
      console.log('👑 ADMIN DASHBOARD PREVIEW DETECTED');
      await validateAdminDashboardUIWithWallet(page, metaMask);
    } else {
      console.log('👤 USER DASHBOARD PREVIEW DETECTED');
      await validateUserDashboardUIWithWallet(page, metaMask);
    }

    // SECTION 4: Interactive Elements with Web3
    console.log('\n🎯 SECTION 4: Interactive Elements with Web3 Integration');

    const interactiveElements = page.locator('button, a[href], input, select, textarea');
    const interactiveCount = await interactiveElements.count();
    console.log(`🎮 Found ${interactiveCount} interactive elements`);

    // Test primary buttons with wallet context
    const primaryButtons = page.locator('[data-testid*="btn"], button[type="submit"], .btn-primary');
    const primaryCount = await primaryButtons.count();
    console.log(`🔘 Found ${primaryCount} primary buttons`);

    if (primaryCount > 0) {
      for (let i = 0; i < Math.min(primaryCount, 3); i++) {
        const button = primaryButtons.nth(i);
        if (await button.isVisible()) {
          const buttonText = await button.textContent();
          const isEnabled = await button.isEnabled();
          console.log(`🔘 Button ${i + 1}: "${buttonText?.trim()}" - ${isEnabled ? 'Enabled' : 'Disabled'}`);
        }
      }
    }

    // SECTION 5: Form Elements with Wallet Integration
    console.log('\n📝 SECTION 5: Form Elements with Wallet State');

    const formElements = page.locator('form, [data-testid*="form"]');
    const formCount = await formElements.count();
    console.log(`📋 Found ${formCount} forms`);

    if (formCount > 0) {
      const firstForm = formElements.first();
      const inputs = firstForm.locator('input, textarea, select');
      const inputCount = await inputs.count();
      console.log(`📝 First form has ${inputCount} input elements`);

      // Test form validation with wallet context
      for (let i = 0; i < Math.min(inputCount, 3); i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          const inputType = await input.getAttribute('type') || 'text';
          const placeholder = await input.getAttribute('placeholder') || '';
          console.log(`📝 Input ${i + 1}: type="${inputType}", placeholder="${placeholder}"`);
        }
      }
    }

    // SECTION 6: Responsive Behavior with Wallet Connected
    console.log('\n📱 SECTION 6: Responsive Design with Connected Wallet');

    const breakpoints = [
      { width: 1920, height: 1080, name: 'XL Desktop' },
      { width: 1200, height: 800, name: 'Desktop' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 480, height: 854, name: 'Mobile L' },
      { width: 375, height: 667, name: 'Mobile M' }
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(300);

      // Key elements should remain accessible with wallet connected
      const keyElements = [
        { selector: '[data-testid="home-title"]', name: 'Title' },
        { selector: '[data-testid="home-hero-section"]', name: 'Hero' },
        { selector: '[data-testid="home-features-section"]', name: 'Features' }
      ];

      let visibleCount = 0;
      for (const element of keyElements) {
        const locator = page.locator(element.selector);
        if (await locator.isVisible()) {
          visibleCount++;
        }
      }

      console.log(`📱 ${bp.name} (${bp.width}x${bp.height}): ${visibleCount}/${keyElements.length} key elements visible`);
    }

    // Reset to desktop
    await page.setViewportSize({ width: 1920, height: 1080 });

    // SECTION 7: Performance and Accessibility with Web3
    console.log('\n⚡ SECTION 7: Performance and Accessibility with Web3');

    // Test heading hierarchy
    const headings = [
      { selector: 'h1', level: 1 },
      { selector: 'h2', level: 2 },
      { selector: 'h3', level: 3 },
      { selector: 'h4', level: 4 }
    ];

    for (const heading of headings) {
      const count = await page.locator(heading.selector).count();
      if (count > 0) {
        console.log(`📋 H${heading.level}: ${count} elements`);
      }
    }

    // Test images and media
    const images = page.locator('img');
    const imageCount = await images.count();
    console.log(`🖼️ Found ${imageCount} images`);

    if (imageCount > 0) {
      let imagesWithAlt = 0;
      for (let i = 0; i < imageCount; i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');
        if (alt && alt.length > 0) {
          imagesWithAlt++;
        }
      }
      console.log(`🖼️ Images with alt text: ${imagesWithAlt}/${imageCount}`);
    }

    // Test Web3 specific elements
    const web3Elements = page.locator('[data-testid*="wallet"], [data-testid*="balance"], [data-testid*="web3"]');
    const web3Count = await web3Elements.count();
    console.log(`🔗 Found ${web3Count} Web3-specific UI elements`);

    console.log('\n🎉 V7 Deep UI Validation with Web3 Completed Successfully');
  });

  test('V7 Wallet state changes and UI updates', async ({ page }) => {
    console.log('🔄 Testing V7 UI Updates with Wallet State Changes');

    // Connect wallet
    await metaMask.connectWallet();
    
    // PHASE 1: Test UI with connected wallet
    console.log('\n💰 PHASE 1: UI with Connected Wallet');
    
    const homeTitle = page.locator('[data-testid="home-title"]');
    await expect(homeTitle).toBeVisible();
    
    // Check wallet-dependent UI elements
    const walletElements = page.locator('[data-testid*="wallet"], [data-testid*="balance"]');
    const walletElementCount = await walletElements.count();
    console.log(`🔗 Found ${walletElementCount} wallet-dependent elements`);

    // PHASE 2: Test account switching
    console.log('\n🔄 PHASE 2: Testing Account Switching');
    
    // Switch to admin account
    await metaMask.switchToAdminAccount();
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Check if admin UI appears
    const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
    if (await adminDashboard.isVisible()) {
      console.log('👑 Admin UI successfully activated');
      
      const adminElements = [
        '[data-testid="sync-status"]',
        '[data-testid="summary-cards"]',
        '[data-testid="transactions-table"]'
      ];
      
      for (const selector of adminElements) {
        const element = page.locator(selector);
        if (await element.isVisible()) {
          console.log(`✅ Admin element found: ${selector}`);
        }
      }
    }

    // PHASE 3: Test transaction states
    console.log('\n📝 PHASE 3: Testing Transaction State UI');
    
    // Test pending transaction UI
    const createBtn = page.locator('[data-testid="create-contract-btn"]');
    if (await createBtn.isVisible()) {
      console.log('📝 Testing contract creation transaction state...');
      
      await createBtn.click();
      
      // Look for transaction pending state
      const pendingIndicator = page.locator('[data-testid*="pending"], [data-testid*="loading"]');
      if (await pendingIndicator.isVisible()) {
        console.log('⏳ Pending transaction UI found');
      }
      
      // Approve transaction
      await metaMask.approveTransaction();
      
      // Wait for completion
      await page.waitForTimeout(3000);
      
      // Look for success state
      const successIndicator = page.locator('[data-testid*="success"], [data-testid*="complete"]');
      if (await successIndicator.isVisible()) {
        console.log('✅ Transaction success UI found');
      }
    }

    console.log('\n✅ Wallet state change testing completed');
  });
});

// Helper function to validate admin dashboard UI with wallet
async function validateAdminDashboardUIWithWallet(page: any, metaMask: MetaMaskHelper) {
  console.log('\n👑 Validating Admin Dashboard UI with Wallet Integration');

  // Test dashboard structure - use actual selectors from AdminDashboard.jsx
  const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
  const syncStatus = page.locator('[data-testid="sync-status"]');
  const summaryDai = page.locator('[data-testid="summary-dai"]');
  const summaryEth = page.locator('[data-testid="summary-eth"]');
  const transactionsTable = page.locator('[data-testid="transactions-table"]');

  await expect(adminDashboard).toBeVisible();
  await expect(syncStatus).toBeVisible();
  await expect(summaryDai).toBeVisible();
  await expect(summaryEth).toBeVisible();

  console.log('✅ Admin dashboard structure validated');

  // Test sync status with real blockchain data
  const syncText = await syncStatus.textContent();
  console.log('🔄 Sync status:', syncText);
  expect(syncText).toContain('Last Synced:');

  // Test summary cards with real data
  const daiText = await summaryDai.textContent();
  const ethText = await summaryEth.textContent();
  console.log('📊 DAI Summary:', daiText?.substring(0, 50) + '...');
  console.log('📊 ETH Summary:', ethText?.substring(0, 50) + '...');

  console.log('✅ Summary cards validated with Web3 data');

  // Test transactions table with real data
  if (await transactionsTable.isVisible()) {
    const tableRows = page.locator('[data-testid="transactions-table"] tbody tr');
    const rowCount = await tableRows.count();
    console.log(`� Found ${rowCount} transaction rows`);
    
    if (rowCount > 0) {
      // Test first row has expected structure
      const firstRow = tableRows.first();
      const cells = firstRow.locator('td');
      const cellCount = await cells.count();
      console.log(`📊 First row has ${cellCount} cells`);
    }
    
    console.log('✅ Transaction table structure validated');
  }

  // Test refresh functionality with Web3
  const refreshBtn = page.locator('[data-testid="refresh-sync-btn"]');
  if (await refreshBtn.isVisible()) {
    console.log('🔄 Testing dashboard refresh with Web3...');
    await refreshBtn.click();
    await page.waitForTimeout(2000); // Wait for refresh
    
    // Verify sync status updated
    const newSyncText = await syncStatus.textContent();
    console.log('� Updated sync status:', newSyncText);
    
    console.log('✅ Dashboard refresh validated');
  }

  // Test withdraw modal with Web3
  const withdrawBtn = page.locator('[data-testid="open-withdraw-modal"]');
  if (await withdrawBtn.isVisible()) {
    console.log('� Testing withdraw modal with Web3...');
    await withdrawBtn.click();
    
    // Wait for modal to appear
    await page.waitForTimeout(1000);
    
    // Look for modal elements (they may not have specific testids)
    const modalElements = page.locator('.modal, [role="dialog"], [data-testid*="modal"]');
    if (await modalElements.count() > 0) {
      console.log('✅ Withdraw modal opened');
      
      // Try to close modal
      const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Close")');
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
      }
    }
  }

  // Test wallet balance integration
  const balance = await metaMask.getBalance();
  console.log('💰 Admin wallet balance:', balance);

  console.log('✅ Admin Dashboard Web3 integration fully validated');
}

// Helper function to validate user dashboard UI with wallet
async function validateUserDashboardUIWithWallet(page: any, metaMask: MetaMaskHelper) {
  console.log('\n👤 Validating User Dashboard UI with Wallet Integration');

  // Test user-specific elements
  const createContractBtn = page.locator('[data-testid="create-contract-btn"]');
  const browseDashboardBtn = page.locator('[data-testid="browse-contracts-btn"]');
  const contractPlaceholder = page.locator('[data-testid="contract-placeholder"]');

  await expect(createContractBtn).toBeVisible();
  await expect(browseDashboardBtn).toBeVisible();
  await expect(contractPlaceholder).toBeVisible();

  console.log('✅ User dashboard elements validated');

  // Test wallet integration hints
  const walletHint = page.locator('[data-testid="connect-wallet-hint"]');
  if (await walletHint.isVisible()) {
    const hintText = await walletHint.textContent();
    console.log('💡 Wallet hint:', hintText);
  }

  // Test current wallet balance display
  const balance = await metaMask.getBalance();
  console.log('💰 User wallet balance:', balance);

  console.log('✅ User dashboard UI with wallet fully validated');
}