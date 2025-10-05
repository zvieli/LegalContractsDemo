import { test, expect } from '@playwright/test';
import { launchWithMetaMask } from './playwright.metamask.setup';

test('Full E2E with MetaMask', async () => {
  const { context, metamask } = await launchWithMetaMask();

  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your frontend

  // Connect to dApp
  await page.click('button:has-text("Connect Wallet")');

  // Automate MetaMask approval
  await metamask.bringToFront();
  await metamask.click('button:has-text("Next")');
  await metamask.click('button:has-text("Connect")');

  // Return to dApp
  await page.bringToFront();

  // Continue with contract creation and evidence upload flow
  // ...existing code...
});
