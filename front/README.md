Front-end notes

This frontend attempts to use the injected wallet provider (e.g. MetaMask) for all on-chain reads and writes. For local development with Hardhat, MetaMask sometimes blocks or returns an internal RPC error ("Execution prevented because the circuit breaker is open").

To make local development smoother the frontend will automatically fall back to a direct JSON-RPC provider at `http://127.0.0.1:8545` for certain read-only RPCs (such as `eth_getCode`) when the app detects it's connected to a localhost chain (chainId 31337/1337/5777) and the injected provider fails.

If you see errors in the browser console about the circuit breaker, ensure your local Hardhat node is running (`npx hardhat node`) and that MetaMask is pointed at the same network.
