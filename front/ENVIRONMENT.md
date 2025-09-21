# Frontend environment and IPFS gateway

This file documents how to configure the frontend to use a local IPFS gateway/pin-server and runtime overrides.

Recommended local gateway
- Local go-ipfs gateway (started via `tools/ipfs/docker-compose.yml`) listens on `http://localhost:8080` by default.

Build-time env (Vite)
- `VITE_PIN_SERVER_URL` — build-time variable used by the frontend to construct IPFS links. Example:

  ```properties
  VITE_PIN_SERVER_URL=http://localhost:8080
  ```

- Note: `VITE_` variables are injected at build time. If you change `front/.env` while the dev server is running you may need to restart the dev server for changes to take effect.

Legacy build-time env (create-react-app style)
- `REACT_APP_PIN_SERVER_URL` — supported for compatibility in some environments. Example:

  ```properties
  REACT_APP_PIN_SERVER_URL=http://localhost:8080
  ```

Runtime override (browser)
- You can override the configured gateway at runtime via `localStorage` using the key `PIN_SERVER_URL`.

  Example (browser console):
  ```js
  localStorage.setItem('PIN_SERVER_URL', 'http://localhost:8080');
  ```

How to apply changes locally
1. Edit `front/.env` (this file is intentionally ignored by git):

   ```properties
   VITE_PIN_SERVER_URL=http://localhost:8080
   REACT_APP_PIN_SERVER_URL=http://localhost:8080
   ```

2. If you're running the Vite dev server, restart it so Vite reloads environment variables:

   ```powershell
   # stop the dev server terminal, then restart
   cd front
   npm run dev
   ```

3. Alternatively, set the runtime override in your browser and reload the app:

   ```js
   localStorage.setItem('PIN_SERVER_URL', 'http://localhost:8080')
   // reload the page
   ```

Verification
- Click any IPFS CID link in the app — the link should point to `http://localhost:8080/ipfs/<cid>` (no double slashes). You can also try fetching the URL directly with `curl.exe` or the browser.

Notes
- `front/.env` is ignored so each developer can keep private or environment-specific values. Use this doc or `.env.example` as a template.
- If you prefer a remote gateway, replace `http://localhost:8080` with `https://ipfs.io` or another gateway URL.
