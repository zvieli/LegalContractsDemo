import { test, expect } from '@playwright/test';

test('open resolve modal and show evidence panel', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#root, #app, body');

  const resolveButton = await page.$('button[data-testid="open-resolve"]') || await page.$('text=Resolve') || await page.$('button:has-text("Resolve")');
  if (resolveButton) {
    await resolveButton.click();
  } else {
    await page.keyboard.press('KeyR');
  }

  const evidencePanel = await page.waitForSelector('[data-testid="evidence-panel"], .evidence-panel, text=Evidence', { timeout: 5000 });
  expect(evidencePanel).toBeTruthy();
});
