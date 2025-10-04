# MetaMask Setup Guide for V7 Admin Dashboard Testing

## Automatic Setup (Recommended)

1. **Download MetaMask Extension**:
   ```bash
   # Download the latest MetaMask extension
   curl -L https://github.com/MetaMask/metamask-extension/releases/latest/download/metamask-chrome.zip -o metamask.zip
   unzip metamask.zip -d metamask-extension
   ```

2. **Configure Playwright with MetaMask**:
   - The test will automatically inject a mock wallet connection
   - No manual setup required for basic testing

## Manual Setup (For Real Testing)

### Step 1: Install MetaMask Extension
1. Open Chrome/Chromium
2. Go to Chrome Web Store
3. Search for "MetaMask"
4. Click "Add to Chrome"

### Step 2: Setup MetaMask Wallet
1. Click on MetaMask icon
2. Choose "Create a new wallet" or "Import existing wallet"
3. If creating new: Save your seed phrase securely
4. Set a strong password

### Step 3: Add Hardhat Local Network
1. Click on the network dropdown (usually shows "Ethereum Mainnet")
2. Click "Add Network" → "Add a network manually"
3. Fill in the details:
   - **Network Name**: Hardhat Local
   - **RPC URL**: http://127.0.0.1:8545
   - **Chain ID**: 31337
   - **Currency Symbol**: ETH
   - **Block Explorer**: (leave empty)
4. Click "Save"

### Step 4: Import Admin Account
1. Click on the account icon (top right)
2. Click "Import Account"
3. Select "Private Key"
4. Enter the admin private key: 
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
5. Click "Import"

### Step 5: Connect to Application
1. Go to http://localhost:5173
2. Look for "Connect Wallet" button
3. Click it and approve the connection in MetaMask
4. Make sure you're on the Hardhat Local network
5. Admin dashboard should appear automatically

## Admin Account Details

- **Address**: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
- **Private Key**: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
- **Balance**: 10000 ETH (on local Hardhat network)

## Verification

After connecting, you should see:
- ✅ Admin dashboard with gradient background
- ✅ Sync status section
- ✅ Total collected DAI/ETH summary cards
- ✅ Bond transactions table
- ✅ Withdraw funds section

## Running Tests

```bash
# Test with simulated wallet connection
npx playwright test admin-dashboard-metamask.e2e.spec.ts --headed

# Test with manual MetaMask setup
npx playwright test admin-dashboard-metamask.e2e.spec.ts --grep "manual" --headed
```

## Troubleshooting

### MetaMask Not Connecting
- Make sure you're on the Hardhat Local network (Chain ID 31337)
- Check that Hardhat node is running: `npm run node`
- Refresh the page and try connecting again

### Admin Dashboard Not Showing
- Verify the admin address matches: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
- Check browser console for errors
- Make sure contracts are deployed: `npm run deploy:localhost`

### Network Issues
- Restart Hardhat node: `npm run node`
- Re-deploy contracts: `npm run deploy:localhost`
- Refresh MetaMask by switching networks and back

## Security Note

The private key provided is only for local development testing. Never use this key on mainnet or with real funds!