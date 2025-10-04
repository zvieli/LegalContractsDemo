import { useEffect, useState, useCallback } from 'react';
import { computeCidDigest } from '../utils/evidenceCanonical.js';

export function useEvidence(fetchOnChainEvidence, caseId, heliaFetch) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (caseId == null) return;
    setLoading(true); setError(null);
    try {
      const chainRefs = await fetchOnChainEvidence(caseId);
      const enriched = await Promise.all(chainRefs.map(async (r) => {
        let json = null; let verified = false; let cid = r.cid;
        try { json = await heliaFetch(cid); } catch (_) {}
        try { if (cid) verified = computeCidDigest(cid) === r.cidDigest; } catch(_) {}
        return { ...r, json, verified, encrypted: !!(json && json.encryption) };
      }));
      setItems(enriched);
    } catch (e) {
      setError(e.message || String(e)); setItems([]);
    } finally { setLoading(false); }
  }, [caseId, fetchOnChainEvidence, heliaFetch]);

  useEffect(()=>{ refresh(); }, [refresh]);

  return { evidence: items, loading, error, refresh };
}
