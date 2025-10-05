// fetchLogger.js - Logs every fetch to /api/v7 endpoints for debugging
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('/api/v7')) {
    console.warn('[API LOG]', args[0], args[1] || {});
  }
  return originalFetch.apply(this, args);
};
