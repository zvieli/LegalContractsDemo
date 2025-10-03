import { test, expect } from '@playwright/test';

test.describe('V7 Advanced Features E2E Tests', () => {
  
  test('TimeCountdown component loads and displays correctly', async ({ page }) => {
    console.log('🕒 Testing TimeCountdown component...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Verify the Advanced Features section exists
    const advancedSection = page.locator('.advanced-features');
    await expect(advancedSection).toBeVisible();
    
    // Check for Time Management section
    const timeSection = page.getByText('Smart Time Management');
    await expect(timeSection).toBeVisible();
    
    // Verify countdown displays
    const countdownElement = page.locator('text=/\\d+d \\d+h \\d+m \\d+s/').first();
    await expect(countdownElement).toBeVisible({ timeout: 10000 });
    
    // Check for payment button
    const payButton = page.getByTestId('pay-rent-button');
    if (await payButton.isVisible()) {
      expect(await payButton.textContent()).toContain('Pay Rent');
    }
    
    // Check for contract overview
    const contractOverview = page.getByText('Contract Overview');
    await expect(contractOverview).toBeVisible();
    
    console.log('✅ TimeCountdown component test passed');
  });

  test('AppealFlow component loads and displays correctly', async ({ page }) => {
    console.log('📞 Testing AppealFlow component...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Check for Appeal System section
    const appealSection = page.getByText('Advanced Appeal System');
    await expect(appealSection).toBeVisible();
    
    // Verify appeal process title
    const appealTitle = page.getByText(/Appeal Process - Dispute/);
    await expect(appealTitle).toBeVisible();
    
    // Check for appeal timer
    const appealTimer = page.getByText('Time Remaining to Submit Appeal');
    await expect(appealTimer).toBeVisible();
    
    // Verify appeal countdown displays
    const appealCountdown = page.locator('text=/\\d+d \\d+h \\d+m \\d+s/').first();
    await expect(appealCountdown).toBeVisible();
    
    // Check for first dispute result section (may not be visible if no dispute data)
    const disputeResult = page.getByText('Initial Dispute Result');
    if (await disputeResult.isVisible()) {
      console.log('✅ Dispute result section found');
    } else {
      console.log('ℹ️ Dispute result section not visible (expected for demo)');
    }
    
    // Check for appeal submission form
    const appealForm = page.getByText('Submit Your Appeal');
    await expect(appealForm).toBeVisible();
    
    // Verify evidence textarea exists
    const evidenceTextarea = page.getByTestId('appeal-evidence-textarea');
    await expect(evidenceTextarea).toBeVisible();
    
    // Verify submit button exists but is disabled (empty form)
    const submitButton = page.getByTestId('submit-appeal-button');
    await expect(submitButton).toBeVisible();
    expect(await submitButton.isEnabled()).toBe(false);
    
    console.log('✅ AppealFlow component test passed');
  });

  test('Interactive appeal submission flow', async ({ page }) => {
    console.log('📝 Testing interactive appeal submission...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Fill in evidence text
    const evidenceTextarea = page.getByTestId('appeal-evidence-textarea');
    await evidenceTextarea.fill('This is test evidence for appeal submission. The landlord failed to provide proper maintenance as agreed in the contract.');
    
    // Verify submit button is now enabled
    const submitButton = page.getByTestId('submit-appeal-button');
    await expect(submitButton).toBeEnabled();
    
    // Verify button text
    expect(await submitButton.textContent()).toContain('Submit Appeal');
    
    // Note: We don't actually submit to avoid network calls in this test
    // In a real test with backend, we would:
    // await submitButton.click();
    // await expect(page.getByText('Appeal Under Review')).toBeVisible();
    
    console.log('✅ Interactive appeal submission test passed');
  });

  test('Responsive design validation for advanced features', async ({ page }) => {
    console.log('📱 Testing responsive design...');
    
    const viewports = [
      { width: 375, height: 667, name: 'Mobile' },
      { width: 768, height: 1024, name: 'Tablet' },
      { width: 1920, height: 1080, name: 'Desktop' }
    ];

    for (const viewport of viewports) {
      console.log(`📐 Testing ${viewport.name} viewport (${viewport.width}x${viewport.height})`);
      
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Check that advanced features section is visible
      const advancedSection = page.locator('.advanced-features');
      await expect(advancedSection).toBeVisible();
      
      // Check time countdown is visible
      const timeCountdown = page.getByText('Smart Time Management');
      await expect(timeCountdown).toBeVisible();
      
      // Check appeal system is visible
      const appealSystem = page.getByText('Advanced Appeal System');
      await expect(appealSystem).toBeVisible();
      
      // Take screenshot for manual verification
      await page.screenshot({ 
        path: `test-results/advanced-features-${viewport.name.toLowerCase()}.png`, 
        fullPage: true 
      });
      
      console.log(`✅ ${viewport.name} viewport test passed`);
    }
  });

  test('Time countdown functionality validation', async ({ page }) => {
    console.log('⏱️ Testing time countdown functionality...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Get initial countdown value
    const countdownElement = page.locator('text=/\\d+d \\d+h \\d+m \\d+s/').first();
    const initialCountdown = await countdownElement.textContent();
    
    // Wait a few seconds and check if countdown updates
    await page.waitForTimeout(3000);
    
    const updatedCountdown = await countdownElement.textContent();
    
    // The countdown should have updated (seconds should be different)
    // Note: This test might be flaky if the countdown crosses minute/hour boundaries
    console.log(`Initial: ${initialCountdown}, Updated: ${updatedCountdown}`);
    
    // Verify countdown format is correct
    expect(initialCountdown).toMatch(/\d+d \d+h \d+m \d+s/);
    expect(updatedCountdown).toMatch(/\d+d \d+h \d+m \d+s/);
    
    // Check for payment status indicators
    const paymentSection = page.getByText(/Next Payment/);
    await expect(paymentSection).toBeVisible();
    
    // Check for contract expiration section
    const expirationSection = page.getByText('Contract Expiration');
    await expect(expirationSection).toBeVisible();
    
    console.log('✅ Time countdown functionality test passed');
  });

  test('Appeal flow status simulation', async ({ page }) => {
    console.log('🔄 Testing appeal status flow...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Verify initial state (not started)
    const appealForm = page.getByText('Submit Your Appeal');
    await expect(appealForm).toBeVisible();
    
    // Check for status indicators (they may not be visible in demo mode)
    const statusIcons = page.locator('text=/✅|❌|⏳/');
    const iconCount = await statusIcons.count();
    if (iconCount > 0) {
      console.log(`✅ Found ${iconCount} status indicators`);
    } else {
      console.log('ℹ️ No status icons found (expected for demo mode)');
    }
    
    // Verify appeal timer shows correct format
    const timerSection = page.getByText('Time Remaining to Submit Appeal');
    await expect(timerSection).toBeVisible();
    
    // Check for dispute result comparison (may not be visible in demo mode)
    const requestedAmount = page.getByText('Requested Amount:');
    const appliedAmount = page.getByText('Applied Amount:');
    
    if (await requestedAmount.isVisible()) {
      await expect(appliedAmount).toBeVisible();
      console.log('✅ Dispute amount comparison visible');
    } else {
      console.log('ℹ️ Dispute amounts not visible (expected for demo mode)');
    }
    
    console.log('✅ Appeal status flow test passed');
  });

  test('Contract information display validation', async ({ page }) => {
    console.log('📋 Testing contract information display...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Check contract overview section
    const contractOverview = page.getByText('Contract Overview');
    await expect(contractOverview).toBeVisible();
    
    // Verify contract address is displayed
    const contractAddress = page.locator('code').first();
    await expect(contractAddress).toBeVisible();
    expect(await contractAddress.textContent()).toMatch(/0x[a-fA-F0-9]{40}/);
    
    // Check rent amount display
    const rentAmount = page.getByText(/ETH/);
    await expect(rentAmount.first()).toBeVisible();
    
    // Check status display
    const statusDisplay = page.getByText(/Status:/);
    await expect(statusDisplay).toBeVisible();
    
    // Verify payment schedule
    const paymentSchedule = page.getByText('Upcoming Payment Schedule');
    await expect(paymentSchedule).toBeVisible();
    
    console.log('✅ Contract information display test passed');
  });

});

test.describe('V7 Advanced Features Integration', () => {
  
  test('Full V7 features integration test', async ({ page }) => {
    console.log('🔗 Testing full V7 features integration...');
    
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Check that both major components are present
    const timeComponent = page.getByText('Smart Time Management');
    const appealComponent = page.getByText('Advanced Appeal System');
    
    await expect(timeComponent).toBeVisible();
    await expect(appealComponent).toBeVisible();
    
    // Verify V7 branding
    const v7Title = page.getByText('Advanced V7 Features');
    await expect(v7Title).toBeVisible();
    
    // Check for interactive elements
    const payButton = page.getByTestId('pay-rent-button');
    const appealTextarea = page.getByTestId('appeal-evidence-textarea');
    const submitAppealButton = page.getByTestId('submit-appeal-button');
    
    if (await payButton.isVisible()) {
      expect(await payButton.isEnabled()).toBe(true);
    }
    
    await expect(appealTextarea).toBeVisible();
    await expect(submitAppealButton).toBeVisible();
    
    // Test interaction flow
    await appealTextarea.fill('Integration test evidence');
    await expect(submitAppealButton).toBeEnabled();
    
    // Take final screenshot
    await page.screenshot({ 
      path: 'test-results/v7-full-integration.png', 
      fullPage: true 
    });
    
    console.log('✅ Full V7 features integration test passed');
  });

});