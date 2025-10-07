import { test, expect } from '@playwright/test';

// Simplified E2E test that bypasses wallet connection entirely
// This tests the basic navigation flow without Web3 interactions

test('Simplified UI Navigation Test', async ({ page }) => {
  // Go to home page
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Test home page elements
  const homeTitle = page.locator('[data-testid="home-title"]');
  await expect(homeTitle).toBeVisible();
  
  // Check that we can navigate to create page
  const createContractBtn = page.locator('[data-testid="create-contract-btn"]');
  await expect(createContractBtn).toBeVisible();
  await createContractBtn.click();
  
  // Should navigate to contract selection page
  await page.waitForURL('**/create');
  
  // Check that contract type cards are visible
  const rentCard = page.getByText('Rental Contract');
  await expect(rentCard).toBeVisible();
  
  console.log('✓ Basic navigation test passed');
});

test('Create-Rent Page Wallet Check', async ({ page }) => {
  // Go directly to create-rent page to test wallet requirement
  await page.goto('http://localhost:5173/create-rent');
  await page.waitForLoadState('networkidle');
  
  // Should show wallet connection message
  const connectMessage = page.locator('text=Connect Your Wallet');
  await expect(connectMessage).toBeVisible();
  
  const walletMessage = page.locator('text=Please connect your wallet to create a rental contract');
  await expect(walletMessage).toBeVisible();
  
  console.log('✓ Wallet requirement check passed');
});