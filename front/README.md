Front-end notes

This frontend attempts to use the injected wallet provider (e.g. MetaMask) for all on-chain reads and writes. For local development with Hardhat, MetaMask sometimes blocks or returns an internal RPC error ("Execution prevented because the circuit breaker is open").

To make local development smoother the frontend will automatically fall back to a direct JSON-RPC provider at `http://127.0.0.1:8545` for certain read-only RPCs (such as `eth_getCode`) when the app detects it's connected to a localhost chain (chainId 31337/1337/5777) and the injected provider fails.

If you see errors in the browser console about the circuit breaker, ensure your local Hardhat node is running (`npx hardhat node`) and that MetaMask is pointed at the same network.


IPFS / pin-server configuration

The frontend supports a local IPFS pin-server or gateway which can be used to pin evidence and serve CID links.

- `VITE_PIN_SERVER_URL` — (Vite build-time) preferred pin/gateway URL, e.g. `http://localhost:8080`.
- `REACT_APP_PIN_SERVER_URL` — (legacy create-react-app build-time) fallback for older build tooling.
- Runtime override: `localStorage` key `PIN_SERVER_URL` — if set in the browser, this value will be used at runtime to build CID links.

Test shim for Node-based JS tests

- Tests can simulate Vite's `import.meta.env.VITE_PIN_SERVER_URL` by assigning `global.__VITE_PIN_SERVER_URL__` in the test environment.

Example localStorage override (browser console):

```js
localStorage.setItem('PIN_SERVER_URL', 'http://localhost:8080');
```
