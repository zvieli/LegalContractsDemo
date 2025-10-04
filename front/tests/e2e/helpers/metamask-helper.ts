import { Page, BrowserContext } from '@playwright/test';

/**
 * MetaMask Helper Functions for E2E Testing
 * Provides utilities to interact with MetaMask extension during tests
 */

export class MetaMaskHelper {
  constructor(private page: Page, private context: BrowserContext) {}

  /**
   * Setup MetaMask with simulation (no extension required)
   */
  async setupWallet() {
    console.log('🦊 Setting up MetaMask wallet...');
    
    // Always use mock injection for reliable testing
    await this.injectMetaMaskMock();
    console.log('✅ MetaMask simulation setup completed');
  }

  /**
   * Connect wallet to the DApp
   */
  async connectWallet() {
    console.log('🔗 Connecting wallet to DApp...');
    
    // Go to the DApp
    await this.page.goto('http://localhost:5173');
    await this.page.waitForLoadState('networkidle');
    
    // Inject or ensure MetaMask is available
    await this.ensureMetaMaskAvailable();
    
    // Look for connect wallet button
    const connectBtn = this.page.locator('button:has-text("Connect"), button:has-text("Wallet")');
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
      await this.approveConnection();
    }
    
    // Wait for connection to be established
    await this.page.waitForTimeout(2000);
  }

  /**
   * Approve a transaction in MetaMask
   */
  async approveTransaction(options: { gasLimit?: string; gasPrice?: string } = {}) {
    console.log('✅ Approving transaction...');
    
    // Wait for MetaMask popup or notification
    await this.page.waitForTimeout(1000);
    
    // Try to find and interact with MetaMask confirmation
    const extensionId = await this.getMetaMaskExtensionId();
    if (extensionId) {
      // Handle real MetaMask popup
      const pages = this.context.pages();
      const metaMaskPage = pages.find(p => p.url().includes('chrome-extension://'));
      
      if (metaMaskPage) {
        await metaMaskPage.waitForLoadState('networkidle');
        
        // Look for confirm button
        const confirmBtn = metaMaskPage.locator('button:has-text("Confirm"), button:has-text("Sign")');
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await metaMaskPage.waitForTimeout(2000);
        }
      }
    } else {
      // Simulate transaction approval for mock MetaMask
      await this.page.evaluate(() => {
        // Trigger transaction success event
        window.dispatchEvent(new CustomEvent('metamask-transaction-approved'));
      });
    }
    
    console.log('✅ Transaction approved');
  }

  /**
   * Switch to admin account
   */
  async switchToAdminAccount() {
    console.log('👑 Switching to admin account...');
    
    await this.ensureMetaMaskAvailable();
    
    // Trigger account change to admin
    await this.page.evaluate(() => {
      if ((window as any).ethereum) {
        const adminAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
        (window as any).ethereum.selectedAddress = adminAddress;
        
        // Trigger account change event
        const event = new CustomEvent('accountsChanged', {
          detail: [adminAddress]
        });
        window.dispatchEvent(event);
        
        // Also trigger on ethereum object if it has listeners
        if ((window as any).ethereum.emit) {
          (window as any).ethereum.emit('accountsChanged', [adminAddress]);
        }
      }
    });
    
    await this.page.waitForTimeout(1500);
    console.log('✅ Switched to admin account');
  }

  /**
   * Get MetaMask extension ID
   */
  private async getMetaMaskExtensionId(): Promise<string | null> {
    try {
      const extensions = await this.context.backgroundPages();
      for (const extension of extensions) {
        const url = extension.url();
        if (url.includes('chrome-extension://') && url.includes('metamask')) {
          return url.split('chrome-extension://')[1].split('/')[0];
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Setup new MetaMask wallet
   */
  private async setupNewWallet() {
    // This would handle initial MetaMask setup
    // For now, we'll use the mock injection method
    console.log('📝 Would setup new MetaMask wallet (using mock for testing)');
  }

  /**
   * Import admin account to MetaMask
   */
  private async importAdminAccount() {
    // This would import the admin private key
    console.log('🔑 Would import admin account (using mock for testing)');
  }

  /**
   * Switch to Hardhat network
   */
  private async switchToHardhatNetwork() {
    console.log('🔗 Switching to Hardhat network...');
    
    await this.page.evaluate(() => {
      if ((window as any).ethereum) {
        (window as any).ethereum.chainId = '0x7a69'; // Hardhat chain ID
      }
    });
  }

  /**
   * Approve connection to DApp
   */
  private async approveConnection() {
    console.log('🤝 Approving DApp connection...');
    
    // Handle connection approval
    await this.page.evaluate(() => {
      if ((window as any).ethereum && (window as any).ethereum.request) {
        // Simulate connection approval
        setTimeout(() => {
          const event = new CustomEvent('accountsChanged', {
            detail: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266']
          });
          window.dispatchEvent(event);
        }, 500);
      }
    });
    
    await this.page.waitForTimeout(1000);
  }

  /**
   * Ensure MetaMask is available on the page
   */
  private async ensureMetaMaskAvailable() {
    await this.page.evaluate(() => {
      if (!(window as any).ethereum) {
        (window as any).ethereum = {
          isMetaMask: true,
          selectedAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          chainId: '0x7a69',
          request: async ({ method, params }: { method: string; params?: any[] }) => {
            console.log(`🦊 MetaMask Request: ${method}`, params);
            
            switch (method) {
              case 'eth_requestAccounts':
              case 'eth_accounts':
                return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
              case 'eth_chainId':
                return '0x7a69';
              case 'eth_getBalance':
                return '0x21e19e0c9bab2400000'; // 10000 ETH
              case 'personal_sign':
                return '0x' + 'mock_signature_web3_flow'.padEnd(130, '0');
              case 'eth_sendTransaction':
                const txHash = '0x' + Math.random().toString(16).substr(2, 62).padEnd(62, '0');
                
                // Simulate transaction processing
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('metamask-transaction-approved', {
                    detail: { txHash }
                  }));
                }, 1000);
                
                return txHash;
              case 'eth_getTransactionReceipt':
                return {
                  status: '0x1',
                  transactionHash: params?.[0] || '0x123',
                  blockNumber: '0x1',
                  gasUsed: '0x5208'
                };
              default:
                return null;
            }
          },
          on: (event: string, handler: any) => {
            console.log(`🦊 MetaMask Event Listener: ${event}`);
            window.addEventListener(`metamask-${event}`, handler);
          },
          removeListener: (event: string, handler: any) => {
            window.removeEventListener(`metamask-${event}`, handler);
          },
          isConnected: () => true
        };
        
        // Trigger initialization
        window.dispatchEvent(new Event('ethereum#initialized'));
      }
    });
  }

  /**
   * Inject MetaMask mock for testing
   */
  private async injectMetaMaskMock() {
    console.log('🔧 Injecting MetaMask mock for testing...');
    await this.ensureMetaMaskAvailable();
  }

  /**
   * Wait for transaction to be mined
   */
  async waitForTransaction(txHash: string, timeout: number = 30000) {
    console.log(`⏳ Waiting for transaction ${txHash} to be mined...`);
    
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const receipt = await this.page.evaluate(async (hash) => {
        if ((window as any).ethereum) {
          return await (window as any).ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [hash]
          });
        }
        return null;
      }, txHash);
      
      if (receipt && receipt.status === '0x1') {
        console.log('✅ Transaction mined successfully');
        return receipt;
      }
      
      await this.page.waitForTimeout(1000);
    }
    
    throw new Error(`Transaction ${txHash} not mined within ${timeout}ms`);
  }

  /**
   * Get current account balance
   */
  async getBalance(): Promise<string> {
    const balance = await this.page.evaluate(async () => {
      if ((window as any).ethereum) {
        return await (window as any).ethereum.request({
          method: 'eth_getBalance',
          params: [(window as any).ethereum.selectedAddress, 'latest']
        });
      }
      return '0x0';
    });
    
    return balance;
  }
}