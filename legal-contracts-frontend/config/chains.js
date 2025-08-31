// config/chains.js
export const SUPPORTED_CHAINS = {
  1: {
    name: 'Ethereum Mainnet',
    rpcUrl: import.meta.env.VITE_MAINNET_RPC_URL,
    explorer: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    }
  },
  5: {
    name: 'Goerli Testnet',
    rpcUrl: import.meta.env.VITE_GOERLI_RPC_URL,
    explorer: 'https://goerli.etherscan.io',
    nativeCurrency: {
      name: 'Goerli Ether',
      symbol: 'ETH',
      decimals: 18
    }
  },
  11155111: {
    name: 'Sepolia Testnet',
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL,
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    }
  }
};

// config/contracts.js
export const CONTRACT_ADDRESSES = {
  5: {
    factory: '0x...',
    rentTemplate: '0x...',
    ndaTemplate: '0x...',
    arbitrator: '0x...'
  },
  11155111: {
    factory: '0x...',
    rentTemplate: '0x...',
    ndaTemplate: '0x...',
    arbitrator: '0x...'
  }
};

// config/rpc.js
export const RPC_PROVIDERS = {
  1: `https://mainnet.infura.io/v3/${import.meta.env.VITE_INFURA_API_KEY}`,
  5: `https://goerli.infura.io/v3/${import.meta.env.VITE_INFURA_API_KEY}`,
  11155111: `https://sepolia.infura.io/v3/${import.meta.env.VITE_INFURA_API_KEY}`
};