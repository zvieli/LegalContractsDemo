// Minimal CCIP API client for frontend
const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ? import.meta.env.VITE_API_BASE.replace(/\/$/, '') : '';

export async function getCcipStatus() {
  const res = await fetch(`${API_BASE}/api/v7/ccip/status`);
  return res.ok ? res.json() : { ok: false, status: res.status };
}

export async function startCcipListener() {
  const res = await fetch(`${API_BASE}/api/v7/ccip/start`, { method: 'POST' });
  return res.ok ? res.json() : { ok: false, status: res.status };
}

export async function testCcipListener(payload = {}) {
  const res = await fetch(`${API_BASE}/api/v7/ccip/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return res.ok ? res.json() : { ok: false, status: res.status };
}

export default { getCcipStatus, startCcipListener, testCcipListener };
