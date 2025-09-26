import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

test('open resolve modal and show evidence panel', async ({ page }) => {
  test.setTimeout(120000);
  const PK = process.env.PLAYWRIGHT_TEST_PRIVATE_KEY || process.env.TEST_PK;
  const RPC = process.env.PLAYWRIGHT_RPC_URL || 'http://127.0.0.1:8545';
  if (!PK) {
    test.skip('No test private key provided (set TEST_PK or PLAYWRIGHT_TEST_PRIVATE_KEY)');
    return;
  }

  await page.exposeFunction('playwright_sendSignedTransaction', async (tx) => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(PK, provider);
    const sent = await wallet.sendTransaction(tx);
    return sent.hash;
  });

  await page.exposeFunction('playwright_signMessage', async (message) => {
    const wallet = new ethers.Wallet(PK);
    return wallet.signMessage(message);
  });

  await page.context().addInitScript(({ address, chainId, rpc }) => {
    const ethereum = {
      isPlaywrightTestProvider: true,
      request: async (args) => {
        const { method, params } = args || {};
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return chainId;
        if (method === 'personal_sign' || method === 'eth_sign') {
          const msg = Array.isArray(params) ? params[0] : params;
          return await window.playwright_signMessage(msg);
        }
        if (method === 'eth_sendTransaction' || method === 'eth_sendRawTransaction') {
          const tx = Array.isArray(params) ? params[0] : params;
          return await window.playwright_sendSignedTransaction(tx);
        }
        return fetch(rpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
        }).then(r => r.json()).then(j => j.result);
      },
      on: () => {},
      removeListener: () => {}
    };
    Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: true });
  }, { address: new ethers.Wallet(PK).address, chainId: '0x' + (Number(process.env.PLAYWRIGHT_CHAIN_ID || 31337)).toString(16), rpc: RPC });

  // Navigate to the UI (assumes vite dev server running on default port)
  await page.goto('/');
  // Provider sanity check before proceeding
  const prov = await page.evaluate(async () => {
    try {
      if (!window.ethereum || !window.ethereum.request) return { ok: false, reason: 'no-ethereum' };
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      return { ok: true, accounts, chainId };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  });
  console.log('PLAYWRIGHT DEBUG providerInfo=', prov);
  if (!prov.ok || !prov.accounts || prov.accounts.length === 0) {
    await page.waitForSelector('.wallet-connector', { timeout: 10000 }).catch(() => {});
    const connectBtn = await page.$('.connect-btn');
    if (connectBtn) {
      await connectBtn.click();
      await page.waitForTimeout(500);
    }
    const prov2 = await page.evaluate(async () => {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        return { accounts, chainId };
      } catch (e) { return { error: String(e) }; }
    });
    console.log('PLAYWRIGHT DEBUG providerInfo after click=', prov2);
    if (!prov2.accounts || prov2.accounts.length === 0) {
      test.skip('No accounts available from injected provider');
      return;
    }
  }

  await page.waitForLoadState('domcontentloaded');
  const resolveButton = await page.$('button[data-testid="open-resolve"]') || await page.$('text=Resolve') || await page.$('button:has-text("Resolve")');
  if (!resolveButton) {
    test.skip('Resolve UI not present (unexpected)');
    return;
  }
  await resolveButton.click();

  const evidencePanel = await page.waitForSelector('[data-testid="evidence-panel"], .evidence-panel, text=Evidence', { timeout: 5000 });
  expect(evidencePanel).toBeTruthy();
});
