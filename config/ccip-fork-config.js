/**
 * Fork-Compatible CCIP Oracle Configuration
 * Adapts CCIP Oracle system to work with Hardhat mainnet fork
 */

// Known mainnet CCIP addresses (if available)
export const MAINNET_CCIP_CONFIG = {
  router: "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D", // CCIP Router on Ethereum
  linkToken: "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK token on Ethereum
  chainSelector: "5009297550715157269", // Ethereum mainnet chain selector
  
  // Fallback to mock if CCIP not available
  useMockIfUnavailable: true
};

// Mock CCIP implementation for fork testing
export const MOCK_CCIP_CONFIG = {
  enableMockMode: true,
  simulateDelay: 2000, // 2 second delay to simulate cross-chain
  autoResolve: true    // Automatically resolve arbitration requests
};

/**
 * Check if real CCIP is available on current network
 */
export async function isCCIPAvailableOnNetwork(provider) {
  try {
    // Try to call CCIP Router
    const code = await provider.getCode(MAINNET_CCIP_CONFIG.router);
    return code !== "0x";
  } catch (error) {
    console.log("CCIP Router not available, falling back to mock mode");
    return false;
  }
}

/**
 * Get appropriate CCIP configuration for current environment
 */
export function getCCIPConfig(networkName, forceMainnet = false) {
  const isMainnetFork = networkName === "hardhat" || networkName === "localhost";
  
  if (forceMainnet || (isMainnetFork && !MOCK_CCIP_CONFIG.enableMockMode)) {
    return {
      type: "mainnet",
      ...MAINNET_CCIP_CONFIG
    };
  }
  
  return {
    type: "mock",
    ...MOCK_CCIP_CONFIG
  };
}