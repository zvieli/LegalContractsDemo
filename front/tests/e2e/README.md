# MetaMask E2E Testing Setup

## Overview
Since Synpress doesn't support Windows yet, we've created a custom MetaMask helper for E2E testing that provides similar functionality.

## Setup

1. **Environment Variables**: Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

2. **MetaMask Extension**: Install MetaMask browser extension manually in Chrome/Edge

3. **Run Tests**:
   ```bash
   npm run e2e
   ```

## Features

- ✅ Automated MetaMask setup with test wallet
- ✅ Hardhat network configuration
- ✅ Multiple account switching  
- ✅ Environment variable configuration
- ✅ Windows compatible

## Files

- `metamask.helper.ts` - Custom MetaMask automation helper
- `ui.e2e.test.ts` - Main E2E test with contract creation and evidence upload
- `.env` - Environment variables (not committed)
- `.env.example` - Template for environment variables

## Migration from Manual Setup

The old manual MetaMask extension setup has been removed in favor of this helper approach, which is:
- More maintainable
- Environment-variable driven
- Compatible with Windows
- Easier to extend for multiple accounts

## Future Migration to Synpress

Once Synpress supports Windows, we can easily migrate by:
1. Replacing the helper with `@synthetixio/synpress`
2. Using `metamask.connect()` and `metamask.switchNetwork()` 
3. Updating the test structure to use Synpress fixtures

The test logic and selectors remain the same.