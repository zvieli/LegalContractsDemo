const selectors = {
  // From ContractFactory.sol custom errors
  '3ac163e9': 'ZeroPriceFeed',
  '0f7b018b': 'ZeroTenant',
  'd6f1f3f7': 'SameAddresses',
  '2e1a7d4f': 'ZeroRentAmount',
  '5f2d8e8a': 'ZeroPartyB',
  '7a1b2c3d': 'SameParties',
  // Add any others discovered
};

const sel = (process.argv[2] || '').replace(/^0x/, '').toLowerCase();
if (!sel) {
  console.log('Usage: node scripts/decodeSelector.cjs <selectorHex>');
  process.exit(1);
}
console.log(sel, '->', selectors[sel] || 'Unknown');
