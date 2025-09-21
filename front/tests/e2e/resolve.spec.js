import { test, expect } from '@playwright/test';

test('open resolve modal and show evidence panel', async ({ page }) => {
  // Navigate to the UI (assumes vite dev server running on default port)
  await page.goto('/');

  // Wait for the app main element
  await page.waitForSelector('#root, #app, body');

  // Try to open the Resolve modal: the app may expose a button with data-testid or text
  const resolveButton = await page.$('button[data-testid="open-resolve"]') || await page.$('text=Resolve') || await page.$('button:has-text("Resolve")');
  if (resolveButton) {
    await resolveButton.click();
  } else {
    // If there's no explicit button, attempt to open a common modal via keyboard shortcut (Escape)
    // This is a best-effort smoke test; adjust selectors to match the app.
    await page.keyboard.press('KeyR');
  }

  // Check EvidencePanel presence — common selector in the frontend implementation
  const evidencePanel = await page.waitForSelector('[data-testid="evidence-panel"], .evidence-panel, text=Evidence', { timeout: 5000 });
  expect(evidencePanel).toBeTruthy();
});
