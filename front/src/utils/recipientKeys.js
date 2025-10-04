// Simple in-memory recipient public key registry (can be replaced with backend fetch)
// Structure: { addressLower: { pubkey, addedAt } }
const registry = new Map();

export function registerRecipient(address, pubkey) {
  if(!address || !pubkey) throw new Error('address & pubkey required');
  registry.set(String(address).toLowerCase(), { pubkey, addedAt: Date.now() });
}

export function getRecipientPubkey(address) {
  if(!address) return null;
  const rec = registry.get(String(address).toLowerCase());
  return rec ? rec.pubkey : null;
}

export function listRecipients() {
  return Array.from(registry.entries()).map(([addr, v]) => ({ address: addr, ...v }));
}

// Seed: platform admin or known participants can be injected at runtime (e.g., window.__EVIDENCE_RECIPIENTS)
if(typeof window !== 'undefined' && window.__EVIDENCE_RECIPIENTS) {
  try { for(const r of window.__EVIDENCE_RECIPIENTS){ registerRecipient(r.address, r.pubkey); } } catch(_){}
}
