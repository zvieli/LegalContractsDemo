// Utility to build an IPFS gateway URL preferring a local pin-server/gateway when configured.
// Normalize a configured gateway URL by trimming and removing trailing slashes.
export function normalizeGatewayUrl(url) {
  if (url === undefined || url === null) return '';
  try {
    return String(url).trim().replace(/\/+$/, '');
  } catch (_) {
    return String(url);
  }
}

export function buildCidUrl(cid) {
  try {
    // Test shim: allow tests to set globalThis.__VITE_PIN_SERVER_URL__ to simulate import.meta.env
    const testShim = (typeof globalThis !== 'undefined' && globalThis.__VITE_PIN_SERVER_URL__) ? globalThis.__VITE_PIN_SERVER_URL__ : null;
    // Prefer Vite build-time variable, then React env, then a runtime localStorage override
    const envPin = testShim || ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PIN_SERVER_URL) ? import.meta.env.VITE_PIN_SERVER_URL : null);
    const reactPin = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_PIN_SERVER_URL) ? process.env.REACT_APP_PIN_SERVER_URL : null;
    // Support both browser window.localStorage and Node global.localStorage (for tests)
    let localPin = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('PIN_SERVER_URL')) {
        localPin = window.localStorage.getItem('PIN_SERVER_URL');
      } else if (typeof globalThis !== 'undefined' && globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function' && globalThis.localStorage.getItem('PIN_SERVER_URL')) {
        localPin = globalThis.localStorage.getItem('PIN_SERVER_URL');
      }
    } catch (_) { localPin = null; }
    const pinServer = envPin || reactPin || localPin || '';
    if (pinServer && String(pinServer).trim().length > 0) {
      const normalized = normalizeGatewayUrl(pinServer);
      return `${normalized}/ipfs/${cid}`;
    }
  } catch (_) {}
  return `https://ipfs.io/ipfs/${cid}`;
}

// Return the selected gateway string (normalized) or empty string if using fallback
export function getSelectedGateway() {
  try {
    const testShim = (typeof globalThis !== 'undefined' && globalThis.__VITE_PIN_SERVER_URL__) ? globalThis.__VITE_PIN_SERVER_URL__ : null;
    const envPin = testShim || ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PIN_SERVER_URL) ? import.meta.env.VITE_PIN_SERVER_URL : null);
    const reactPin = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_PIN_SERVER_URL) ? process.env.REACT_APP_PIN_SERVER_URL : null;
    let localPin = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('PIN_SERVER_URL')) {
        localPin = window.localStorage.getItem('PIN_SERVER_URL');
      } else if (typeof globalThis !== 'undefined' && globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function' && globalThis.localStorage.getItem('PIN_SERVER_URL')) {
        localPin = globalThis.localStorage.getItem('PIN_SERVER_URL');
      }
    } catch (_) { localPin = null; }
    const pinServer = envPin || reactPin || localPin || '';
    return pinServer ? normalizeGatewayUrl(pinServer) : '';
  } catch (_) { return ''; }
}

// Debug helper: logs chosen gateway when VITE_DEBUG is truthy
export function logSelectedGateway() {
  try {
    const shouldLog = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DEBUG === 'true') || (typeof process !== 'undefined' && process.env && process.env.VITE_DEBUG === 'true');
    if (!shouldLog) return;
    const g = getSelectedGateway();
    // eslint-disable-next-line no-console
    console.log(`[ipfs] selected gateway: ${g || 'fallback ipfs.io'}`);
  } catch (_) {}
}
