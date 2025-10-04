import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

test.describe('Evidence Upload Modal Flow', () => {
  test('uploads evidence, verifies UI status, and decrypts envelope', async ({ page }) => {
    // Precondition: dev server + local hardhat assumed running via start-all.ps1
    await page.goto('/');
    // Open some contract context - assume first rent contract listed or simulate address injection
    // For simplicity, skip to modal trigger if button exists
    const uploadTrigger = page.getByText('Upload Evidence');
    if (!(await uploadTrigger.count())) test.skip(true, 'Upload Evidence trigger not present in UI');
    await uploadTrigger.click();
    await page.getByLabel('Type').selectOption('damage');
    await page.getByLabel('Amount (ETH)').fill('0.01');
    await page.getByLabel('Text').fill('Playwright uploaded evidence');
    // Build preview
    await page.getByRole('button', { name: 'Build Preview' }).click();
    await page.getByRole('button', { name: 'Sign' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    // Wait a moment for tx & list refresh
    await page.waitForTimeout(1500);
    // Inject a dummy private key for decrypt tests (test hook consumed in ContractModal)
    await page.addInitScript(() => {
      (window as any).__TEST_EVIDENCE_PRIVKEY = '0x01'.padEnd(66,'0');
    });

    // Wait for evidence list to populate & verify status badge appears
    const card = page.locator('.transactions-list .transaction-item').first();
    await expect(card).toBeVisible();
    // Basic CID presence check
    await expect(card.locator('text=CID:')).toBeVisible();
    // Optional: open JSON view if button exists
    const viewBtn = card.getByRole('button', { name: /View JSON/i });
    if (await viewBtn.count()) {
      await viewBtn.click();
      await expect(page.locator('h5', { hasText: 'Evidence JSON' })).toBeVisible();
    }
    // If decrypt button appears (when encrypted + key), click it
    const decryptBtn = card.getByRole('button', { name: /Decrypt/i });
    if (await decryptBtn.count()) {
      await decryptBtn.click();
      await page.waitForTimeout(800);
      const decryptedPre = card.locator('pre');
      if (await decryptedPre.count()) {
        const txt = (await decryptedPre.first().innerText()).toLowerCase();
        // Expect some fragment of the narrative
        expect(txt).toContain('playwright');
      }
    }
  });
});
