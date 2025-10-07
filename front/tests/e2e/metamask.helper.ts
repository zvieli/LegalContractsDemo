import { chromium, BrowserContext, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

// Hardhat private keys from WALLETS.txt
const HARDHAT_PRIVATE_KEYS = [
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
];

export interface MetaMaskHelper {
  page: Page;
  context: BrowserContext;
  switchAccount: (index: number) => Promise<void>;
  addNetwork: (network: NetworkConfig) => Promise<void>;
  connect: () => Promise<void>;
}

export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: string;
  symbol: string;
}

export async function setupMetaMask(): Promise<MetaMaskHelper> {
  // For Windows compatibility, we'll create a browser context without MetaMask extension
  // and simulate Web3 provider injection
  const context = await chromium.launch({
    headless: false,
    args: [
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  }).then(browser => browser.newContext());

  // Create a page for our operations
  const page = await context.newPage();
  
  // Inject Web3 provider simulation - PRE-CONNECT it so the app sees it as already connected
  await page.addInitScript(() => {
    console.log('🚀 INJECTING ETHEREUM PROVIDER SIMULATION');
    
    // Set E2E environment variables so the app knows we're in test mode
    if (typeof window !== 'undefined') {
      (window as any).__E2E_TESTING__ = true;
      // Mock import.meta.env for E2E mode
      if (!(window as any).import) {
        (window as any).import = { meta: { env: {} } };
      }
      if (!(window as any).import.meta) {
        (window as any).import.meta = { env: {} };
      }
      (window as any).import.meta.env.VITE_E2E_TESTING = 'true';
    }
    
    // Mock ethereum provider for testing - START WITH CONNECTION ALREADY ESTABLISHED
    const mockAccounts = [
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Account 0
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Account 1
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // Account 2
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // Account 3
      '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'  // Account 4
    ];

    let isConnected = true; // START CONNECTED!
    let selectedAccount = mockAccounts[0];

    // Create the mock provider
    const mockEthereum = {
      isMetaMask: true,
      selectedAddress: selectedAccount, // START WITH SELECTED ADDRESS
      chainId: '0x7a69', // 31337 in hex (Hardhat)
      networkVersion: '31337',
      isConnected: () => {
        console.log('🔗 ethereum.isConnected() called, returning:', isConnected);
        return isConnected;
      },
      
      request: async (params: any) => {
        console.log('📨 Mock ethereum.request called with:', params);
        switch (params.method) {
          case 'eth_requestAccounts':
            console.log('🔐 eth_requestAccounts - returning accounts:', [selectedAccount]);
            isConnected = true;
            mockEthereum.selectedAddress = selectedAccount;
            // Trigger accountsChanged event
            if (mockEthereum._accountsChangedHandlers) {
              mockEthereum._accountsChangedHandlers.forEach((handler: Function) => {
                handler([selectedAccount]);
              });
            }
            // Also trigger connect event
            if (mockEthereum._connectHandlers) {
              mockEthereum._connectHandlers.forEach((handler: Function) => {
                handler({ chainId: '0x7a69' });
              });
            }
            return [selectedAccount];
          case 'eth_accounts':
            const accounts = isConnected ? [selectedAccount] : [];
            console.log('👤 eth_accounts - returning:', accounts);
            return accounts;
          case 'eth_chainId':
            console.log('🔗 eth_chainId - returning: 0x7a69');
            return '0x7a69'; // 31337 in hex (Hardhat)
          case 'wallet_addEthereumChain':
            console.log('➕ wallet_addEthereumChain - success');
            return null; // Success
          case 'wallet_switchEthereumChain':
            console.log('🔄 wallet_switchEthereumChain - success');
            return null; // Success
          case 'eth_sendTransaction':
            // Mock transaction - return a fake hash
            const txHash = '0x' + Math.random().toString(16).substring(2).padEnd(64, '0');
            console.log('💸 eth_sendTransaction - returning:', txHash);
            return txHash;
          case 'personal_sign':
            // Mock signature
            const sig = '0x' + Math.random().toString(16).substring(2).padEnd(130, '0');
            console.log('✍️ personal_sign - returning:', sig);
            return sig;
          case 'eth_getBalance':
            // Return some mock balance
            const balance = '0x' + (1000000000000000000n).toString(16); // 1 ETH
            console.log('💰 eth_getBalance - returning:', balance);
            return balance;
          default:
            console.log(`❓ Mock ethereum - unsupported method: ${params.method}`);
            return null;
        }
      },
      
      on: (event: string, handler: Function) => {
        console.log(`👂 Mock ethereum.on(${event})`);
        if (event === 'accountsChanged') {
          if (!mockEthereum._accountsChangedHandlers) {
            mockEthereum._accountsChangedHandlers = [];
          }
          mockEthereum._accountsChangedHandlers.push(handler);
        } else if (event === 'connect') {
          if (!mockEthereum._connectHandlers) {
            mockEthereum._connectHandlers = [];
          }
          mockEthereum._connectHandlers.push(handler);
        }
      },
      
      removeListener: (event: string, handler: Function) => {
        console.log(`🚫 Mock ethereum.removeListener(${event})`);
        if (event === 'accountsChanged' && mockEthereum._accountsChangedHandlers) {
          const index = mockEthereum._accountsChangedHandlers.indexOf(handler);
          if (index > -1) {
            mockEthereum._accountsChangedHandlers.splice(index, 1);
          }
        } else if (event === 'connect' && mockEthereum._connectHandlers) {
          const index = mockEthereum._connectHandlers.indexOf(handler);
          if (index > -1) {
            mockEthereum._connectHandlers.splice(index, 1);
          }
        }
      },

      // Helper to simulate account switching
      switchAccount: (accountIndex: number) => {
        if (accountIndex < mockAccounts.length) {
          selectedAccount = mockAccounts[accountIndex];
          mockEthereum.selectedAddress = selectedAccount;
          if (mockEthereum._accountsChangedHandlers) {
            mockEthereum._accountsChangedHandlers.forEach((handler: Function) => {
              handler([selectedAccount]);
            });
          }
        }
      },

      // Storage for event handlers
      _accountsChangedHandlers: [] as Function[],
      _connectHandlers: [] as Function[]
    };

    // Set ethereum provider BEFORE any React initialization
    (window as any).ethereum = mockEthereum;

    // Make ethereum available globally and detect providers
    if (!(window as any).web3) {
      (window as any).web3 = {
        currentProvider: mockEthereum
      };
    }

    console.log('✅ Mock Ethereum provider injected successfully');
    console.log('📊 Initial state:', {
      selectedAddress: mockEthereum.selectedAddress,
      isConnected: mockEthereum.isConnected(),
      chainId: mockEthereum.chainId
    });

    // Announce the provider to the window for React apps to detect
    window.dispatchEvent(new Event('ethereum#initialized'));
    
    // Also dispatch a connect event immediately
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('accountsChanged', { 
        detail: [selectedAccount] 
      }));
    }, 100);
  });

  return {
    page,
    context,
    switchAccount: async (index: number) => {
      await switchToAccount(page, index);
    },
    addNetwork: async (network: NetworkConfig) => {
      await addHardhatNetwork(page, network);
    },
    connect: async () => {
      await connectWallet(page);
    }
  };
}

async function setupMetaMaskWallet(page: Page): Promise<void> {
  // This function is not needed for simulation mode
  console.log('Web3 simulation mode - no MetaMask setup required');
}

async function switchToAccount(page: Page, accountIndex: number): Promise<void> {
  // In simulation mode, just update the mock account
  await page.evaluate((index) => {
    const accounts = [
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Account 0
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Account 1
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // Account 2
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // Account 3
      '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'  // Account 4
    ];
    if ((window as any).ethereum && accounts[index]) {
      (window as any).ethereum.selectedAddress = accounts[index];
    }
  }, accountIndex);
  console.log(`Switched to account ${accountIndex}`);
}

async function addHardhatNetwork(page: Page, network: NetworkConfig): Promise<void> {
  // In simulation mode, just update the mock network
  await page.evaluate((net) => {
    if ((window as any).ethereum) {
      (window as any).ethereum.chainId = net.chainId;
      (window as any).ethereum.networkVersion = net.chainId;
    }
  }, network);
  console.log(`Added network: ${network.name}`);
}

async function connectWallet(page: Page): Promise<void> {
  try {
    // First trigger the wallet connection by calling eth_requestAccounts
    await page.evaluate(async () => {
      if ((window as any).ethereum) {
        await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      }
    });

    // Wait a moment for the connection to be processed
    await page.waitForTimeout(1000);

    // Look for connect wallet button on the dApp and click it if it exists
    const connectButton = page.locator('button:has-text("Connect"), [data-testid="connect-wallet"], button:has-text("Connect Wallet")');
    
    const isVisible = await connectButton.isVisible();
    if (isVisible) {
      await connectButton.click();
      await page.waitForTimeout(2000);
    }

    // Verify connection by checking if wallet address is displayed or if connect button is gone
    const isConnected = await page.evaluate(() => {
      return (window as any).ethereum && (window as any).ethereum.selectedAddress;
    });

    if (isConnected) {
      console.log('Wallet connected successfully (simulation mode)');
    } else {
      console.log('Wallet connection may have failed - continuing anyway');
    }
  } catch (error) {
    console.log('Connect wallet simulation error:', error);
    // Continue anyway - the wallet connection might work differently
  }
}