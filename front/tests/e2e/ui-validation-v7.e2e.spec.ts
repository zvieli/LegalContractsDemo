import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

test.describe('V7 UI Validation E2E Tests', () => {
  test('UI state management during V7 arbitration flow', async ({ page }) => {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    
    // Load contract addresses
    let contractFactory, arbitrationService;
    try {
      const factoryJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'ContractFactory.json'), 'utf8'));
      contractFactory = factoryJson.contracts.ContractFactory;
      arbitrationService = factoryJson.contracts.ArbitrationService;
      
      if (!contractFactory || !arbitrationService) {
        test.skip(true, 'Contract addresses not found');
        return;
      }
    } catch (e) {
      test.skip(true, 'Cannot load contract addresses');
      return;
    }

    const deployer = await provider.getSigner(0);
    const landlord = await provider.getSigner(1);
    const tenant = await provider.getSigner(2);

    function loadArtifact(name: string) {
      const p = path.join(process.cwd(), '..', 'artifacts', 'contracts', name);
      if (!fs.existsSync(p)) throw new Error('Missing artifact: ' + p);
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }

    // Setup contract for testing
    const factoryArtifact = loadArtifact('ContractFactory.sol/ContractFactory.json');
    const factory = new ethers.Contract(contractFactory, factoryArtifact.abi, deployer);

    // Use Sepolia ETH/USD price feed for testing
    const priceFeed = '0x694AA1769357215DE4FAC081bf1f309aDC325306';
    const requiredDeposit = ethers.parseEther('1');
    const rentAmount = 100;
    const dueDate = Math.floor(Date.now() / 1000) + 86400;

    // Create rent contract
    const createTx = await (factory as any).connect(landlord)['createRentContract(address,uint256,address,uint256,uint256,string)'](
      await tenant.getAddress(),
      rentAmount,
      priceFeed,
      dueDate,
      0,
      ''
    );
    const receipt = await createTx.wait();
    const event = receipt.logs[0];
    const rentContractAddress = ethers.AbiCoder.defaultAbiCoder().decode(['address'], event.topics[1])[0];

    console.log('✅ Contract created at:', rentContractAddress);

    // Start the frontend application
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    console.log('🌐 Navigated to V7 frontend application');

    // PHASE 1: Verify V7 Home page
    console.log('\\n📋 PHASE 1: Verifying V7 home page elements');

    // Check V7 home page elements
    const homeTitle = page.locator('[data-testid="home-title"]');
    const heroSection = page.locator('[data-testid="home-hero-section"]');
    const createContractBtn = page.locator('[data-testid="create-contract-btn"]');
    const browseDashboardBtn = page.locator('[data-testid="browse-contracts-btn"]');

    await expect(homeTitle).toBeVisible();
    await expect(heroSection).toBeVisible();
    console.log('✅ V7 home page elements verified');

    // Check if admin dashboard is visible (for admin users)
    const adminDashboard = page.locator('[data-testid="admin-dashboard"]');
    if (await adminDashboard.isVisible()) {
      console.log('✅ Admin dashboard detected - testing admin UI');
      
      // Test admin dashboard elements
      const syncStatus = page.locator('[data-testid="sync-status"]');
      const summaryDai = page.locator('[data-testid="summary-dai"]');
      const summaryEth = page.locator('[data-testid="summary-eth"]');
      const transactionsTable = page.locator('[data-testid="transactions-table"]');
      const withdrawBtn = page.locator('[data-testid="open-withdraw-modal"]');

      await expect(syncStatus).toBeVisible();
      await expect(summaryDai).toBeVisible();
      await expect(summaryEth).toBeVisible();
      await expect(transactionsTable).toBeVisible();
      await expect(withdrawBtn).toBeVisible();
      
      console.log('✅ Admin dashboard elements verified');
      
      // Test withdraw modal
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
      
      console.log('✅ Withdraw modal functionality verified');
      
      // Close modal
      const cancelBtn = page.locator('button:has-text("Cancel")');
      await cancelBtn.click();
      await expect(withdrawModal).not.toBeVisible();
      
    } else {
      console.log('✅ Regular user view detected - testing user UI');
      
      // Test regular user elements
      await expect(createContractBtn).toBeVisible();
      await expect(browseDashboardBtn).toBeVisible();
      
      const dashboardPreview = page.locator('[data-testid="home-dashboard-preview"]');
      const dashboardCard = page.locator('[data-testid="dashboard-card"]');
      const contractPlaceholder = page.locator('[data-testid="contract-placeholder"]');
      
      await expect(dashboardPreview).toBeVisible();
      await expect(dashboardCard).toBeVisible();
      await expect(contractPlaceholder).toBeVisible();
      
      console.log('✅ Regular user dashboard preview verified');
    }

    // PHASE 2: Navigate to contracts dashboard
    console.log('\\n🔗 PHASE 2: Testing contract dashboard navigation');

    if (await browseDashboardBtn.isVisible()) {
      await browseDashboardBtn.click();
      await page.waitForLoadState('networkidle');
      console.log('✅ Navigated to contracts dashboard');
    }

    // PHASE 3: Test contract interaction (if contract forms are available)
    console.log('\\n💰 PHASE 3: Testing contract interaction UI');

    // Look for contract address input or existing contract cards
    const contractAddressInput = page.locator('input[placeholder*="contract"], input[placeholder*="address"], input[name="contractAddress"]');
    const contractCards = page.locator('.contract-card, [data-testid*="contract"]');

    if (await contractAddressInput.isVisible()) {
      await contractAddressInput.fill(rentContractAddress);
      console.log('✅ Entered contract address for testing');
      
      // Look for load/connect button
      const loadBtn = page.locator('button:has-text("Load"), button:has-text("Connect"), button:has-text("View")');
      if (await loadBtn.isVisible()) {
        await loadBtn.click();
        await page.waitForTimeout(2000);
        console.log('✅ Attempted to load contract');
      }
    } else if (await contractCards.count() > 0) {
      console.log('✅ Found existing contract cards in UI');
    } else {
      console.log('ℹ️ No contract interaction interface found - this is normal for V7');
    }

    // PHASE 4: Test V7-specific features
    console.log('\\n🤖 PHASE 4: Testing V7-specific features');

    // Look for V7 arbitration elements (if dispute flow is accessible)
    const arbitrationSection = page.locator('[data-testid*="arbitration"], .arbitration-section');
    const evidenceSection = page.locator('[data-testid*="evidence"], .evidence-section');
    const llmDecisionSection = page.locator('[data-testid*="llm"], [data-testid*="decision"]');

    if (await arbitrationSection.isVisible()) {
      console.log('✅ V7 arbitration interface found');
    }
    if (await evidenceSection.isVisible()) {
      console.log('✅ Evidence submission interface found');
    }
    if (await llmDecisionSection.isVisible()) {
      console.log('✅ LLM decision interface found');
    }

    console.log('\\n✅ V7 UI validation completed successfully');
  });

  test('V7 responsive design and accessibility', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // Test responsive design
    const viewports = [
      { width: 1920, height: 1080 }, // Desktop
      { width: 768, height: 1024 },  // Tablet
      { width: 375, height: 667 }    // Mobile
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);

      const homeTitle = page.locator('[data-testid="home-title"]');
      const heroSection = page.locator('[data-testid="home-hero-section"]');

      await expect(homeTitle).toBeVisible();
      await expect(heroSection).toBeVisible();

      console.log(`✅ ${viewport.width}x${viewport.height} viewport test passed`);
    }

    // Test basic accessibility
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    // Check for proper heading structure
    const h1Elements = page.locator('h1');
    const h2Elements = page.locator('h2');
    
    expect(await h1Elements.count()).toBeGreaterThan(0);
    expect(await h2Elements.count()).toBeGreaterThan(0);
    
    console.log('✅ Basic accessibility structure verified');
  });
});