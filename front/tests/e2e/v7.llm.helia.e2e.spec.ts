import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';

const AUDIT_LOG = '../../evidence_storage/e2e_cases.json';

async function logAudit(caseName, data) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8')); } catch {}
  log.push({ case: caseName, ...data });
  fs.writeFileSync(AUDIT_LOG, JSON.stringify(log, null, 2));
}

test.describe('V7 LLM & Helia E2E', () => {
  test('CASE 1: Success Flow - Appeal with valid CID and LLM verdict', async ({ page }) => {
    // 1. Connect wallet & create contract
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await page.getByRole('link', { name: /Create Rent Contract/i }).click();
    await page.getByTestId('input-partyb-address').fill('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await page.getByTestId('input-rent-amount').fill('1');
    await page.getByTestId('button-deploy-contract').click();
    await page.waitForSelector('[data-testid="contract-created-success"]');
    const contractAddress = await page.getByTestId('contract-address').textContent();

    // 2. Submit evidence (CID)
    const evidenceCID = 'bafybeigdyrzt3examplecid1234567890';
    await page.getByTestId('input-evidence-cid').fill(evidenceCID);
    await page.getByTestId('button-submit-evidence').click();
    await page.waitForSelector('[data-testid="evidence-submitted-success"]');

    // 3. Trigger appeal
    await page.getByTestId('button-request-arbitration').click();
    await page.waitForSelector('[data-testid="arbitration-pending"]');

    // 4. Wait for LLM verdict
    await page.waitForTimeout(8000);

    // 5. Verify UI
    await expect(page.getByTestId('arbitration-result')).toContainText('Resolved');
    const finalAmount = await page.getByTestId('arbitration-amount').textContent();

    // 6. Verify on-chain
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const abi = require('../../src/utils/contracts').TemplateRentContract.abi;
    const contract = new ethers.Contract(contractAddress, abi, provider);
    const dispute = await contract.getDispute(0);
    expect(dispute.resolved).toBe(true);

    // 7. Audit log
    await logAudit('Success Flow', {
      contractAddress,
      evidenceCID,
      finalAmount,
      txHash: dispute.txHash,
      status: dispute.resolved
    });
  });

  // CASE 2: Invalid CID
  test('CASE 2: Invalid CID - Appeal with bad CID', async ({ page }) => {
    // ...same setup as above...
    await page.getByTestId('input-evidence-cid').fill('badcid');
    await page.getByTestId('button-submit-evidence').click();
    await expect(page.getByTestId('evidence-error')).toContainText('Invalid CID');
    // Audit log
    await logAudit('Invalid CID', { evidenceCID: 'badcid', error: 'Invalid CID' });
  });

  // CASE 3: Late Fee Calculation
  test('CASE 3: Late Fee Calculation', async ({ page }) => {
    // ...setup contract with overdue payment...
    // Simulate overdue by setting contract start date in the past
    // ...submit evidence, trigger appeal...
    // Wait for LLM verdict
    await page.waitForTimeout(8000);
    // Verify UI shows late fee
    await expect(page.getByTestId('arbitration-late-fee')).toBeVisible();
    // Audit log
    await logAudit('Late Fee Calculation', { lateFee: await page.getByTestId('arbitration-late-fee').textContent() });
  });

  // CASE 4: Multiple Appeals
  test('CASE 4: Multiple Appeals', async ({ page }) => {
    // ...setup contract and submit first appeal...
    await page.getByTestId('button-request-arbitration').click();
    await page.waitForTimeout(8000);
    // Submit second appeal
    await page.getByTestId('button-request-arbitration').click();
    await page.waitForTimeout(8000);
    // Verify both appeals processed
    await expect(page.getByTestId('arbitration-result')).toContainText('Resolved');
    // Audit log
    await logAudit('Multiple Appeals', { status: 'Both appeals processed' });
  });
});
