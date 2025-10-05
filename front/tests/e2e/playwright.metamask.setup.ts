import { chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';

// Path to unpacked MetaMask extension (download and unzip from https://github.com/MetaMask/metamask-extension/releases)
const METAMASK_PATH = path.resolve(process.cwd(), 'tests', 'e2e', 'metamask-extension');

// Test wallet mnemonic (replace with your test mnemonic from WALLETS.txt)
const TEST_MNEMONIC = 'test test test test test test test test test test test junk'; // Example

export async function launchWithMetaMask(): Promise<{ context: BrowserContext, metamask: Page }> {
  // Launch Chromium with MetaMask extension
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${METAMASK_PATH}`,
      `--load-extension=${METAMASK_PATH}`,
    ],
  });

  // Find MetaMask extension page dynamically
  const metamaskPage = context.pages().find(page =>
    page.url().startsWith('chrome-extension://') && page.url().includes('/home.html')
  ) || await context.waitForEvent('page', page =>
    page.url().startsWith('chrome-extension://') && page.url().includes('/home.html')
  );

  // Extract extension ID from the URL
  const extensionId = metamaskPage.url().split('chrome-extension://')[1].split('/')[0];

  // Onboarding: Import wallet
  await metamaskPage.goto(`chrome-extension://${extensionId}/home.html`);
  await metamaskPage.click('text=Get Started');
    // Try to create a new wallet, or use Secret Recovery Phrase if that's the only option
    let created = false;
    try {
      await metamaskPage.waitForSelector('[data-testid="onboarding-create-wallet"]', { timeout: 10000 });
      await metamaskPage.click('[data-testid="onboarding-create-wallet"]');
      created = true;
    } catch (e) {
      // If not found, try SRP button
    const srpBtn = metamaskPage.locator('[data-testid="onboarding-create-with-srp-button"]');
    await srpBtn.waitFor({ state: 'visible', timeout: 20000 });
    await srpBtn.click();
      created = true;
    }
    if (created) {
      await metamaskPage.click('text=I Agree');
      // Fill seed phrase for wallet creation
      const seedPhrase = 'blade december increase review dial shine quote expire menu truth shrimp twenty';
      const words = seedPhrase.split(' ');
      for (let i = 0; i < words.length; i++) {
        await metamaskPage.fill(`input[data-testid="import-srp__srp-word-${i}"]`, words[i]);
      }
      await metamaskPage.fill('input[type="password"]', 'Password123');
      await metamaskPage.fill('input[type="password"]:nth-of-type(2)', 'Password123');
      await metamaskPage.click('button[type="submit"]');
      // Try to click Next/Done if present
      try { await metamaskPage.click('text=Next'); } catch (e) {}
      try { await metamaskPage.click('text=Done'); } catch (e) {}
    }

  // Import all private keys from WALLETS.txt
  const privateKeys = [
    'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    '7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    '47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    '8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    '92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
    '4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
    'dbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
    '2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
    'f214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897',
    '701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82',
    'a267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1',
    '47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd',
    'c526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa',
    '8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61',
    'ea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0',
    '689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd',
    'de9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0',
    'df57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e'
  ];
  for (const key of privateKeys) {
    // Open account menu
    await metamaskPage.click('[data-testid="account-menu-icon"]');
    await metamaskPage.click('text=Import account');
    await metamaskPage.fill('input[type="text"]', key);
    await metamaskPage.click('button[type="submit"]');
    // Wait for import to finish (can be improved with a more robust check)
    await metamaskPage.waitForTimeout(1000);
  }

  // Add Hardhat network
  await metamaskPage.click('button:has-text("Networks")');
  await metamaskPage.click('text=Add network');
  await metamaskPage.click('text=Add a network manually');
  await metamaskPage.fill('input#network-name', 'Hardhat');
  await metamaskPage.fill('input#network-rpc-url', 'http://127.0.0.1:8545');
  await metamaskPage.fill('input#network-chain-id', '31337');
  await metamaskPage.fill('input#network-currency-symbol', 'ETH');
  await metamaskPage.click('button:has-text("Save")');

  // Import account by private key (from WALLETS.txt, example: Account #0)
  await metamaskPage.click('button:has-text("Account options")');
  await metamaskPage.click('text=Import account');
  await metamaskPage.fill('input[type="password"]', 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  await metamaskPage.click('button:has-text("Import")');

  // MetaMask is now ready
  return { context, metamask: metamaskPage };
}
