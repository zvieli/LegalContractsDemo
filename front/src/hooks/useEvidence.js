import { useEffect, useState, useCallback } from 'react';
import { computeCidDigest, computeContentDigest, canonicalize } from '../utils/evidenceCanonical.js';
import { verifyTypedData } from 'ethers';

/**
 * useEvidence
 * Responsibilities:
 *  - Query on-chain EvidenceSubmitted events for a given contract + caseId
 *  - Fetch each CID via heliaFetch (must resolve JSON)
 *  - Verify cidDigest (event) vs recomputed
 *  - Verify contentDigest vs canonicalized JSON (after removing transient fields)
 *  - Verify EIP-712 uploader signature if present
 *  - Classify status badges: verified | cid-mismatch | content-mismatch | sig-invalid | fetch-failed
 */
export function useEvidence(contractInstance, caseId, heliaFetch) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!contractInstance || caseId == null) return;
    setLoading(true); setError(null);
    try {
      // 1. Query events
      let events = [];
      try {
        const filter = contractInstance.filters.EvidenceSubmitted(caseId);
        events = await contractInstance.queryFilter(filter, 0, 'latest');
      } catch (e) {
        console.error('queryFilter EvidenceSubmitted failed', e);
      }
      const enriched = await Promise.all(events.map(async (ev) => {
        const { args } = ev;
        const evCaseId = Number(args?.caseId || args?.[0] || 0);
        const cidDigestEvent = args?.cidDigest || args?.[1];
        const submitter = args?.submitter || args?.[2];
        const cid = args?.cid || args?.[3];
        let status = 'pending';
        let fetched = null; let cidDigestLocal = null; let contentDigestLocal = null; let sigValid = null; let encrypted = false;
        try {
          cidDigestLocal = computeCidDigest(cid);
          if (cidDigestLocal.toLowerCase() !== String(cidDigestEvent).toLowerCase()) {
            status = 'cid-mismatch';
          }
          try { fetched = await heliaFetch(cid); } catch (fe) { status = 'fetch-failed'; }
          if (fetched) {
            // Determine canonical content for digest recompute (exclude signature & envelope-only fields)
            const baseForDigest = { ...fetched };
            delete baseForDigest.signature; // not part of digest originally
            if (baseForDigest.ciphertext && baseForDigest.encryption) {
              encrypted = true;
            }
            const canon = canonicalize(baseForDigest);
            contentDigestLocal = computeContentDigest(canon);
            if (fetched.contentDigest && fetched.contentDigest.toLowerCase() !== contentDigestLocal.toLowerCase()) {
              status = status === 'pending' ? 'content-mismatch' : status;
            }
            // Signature verification
            if (fetched.signature && fetched.uploader && fetched.contentDigest) {
              try {
                const domain = { name: 'Evidence', version: '1', chainId: Number(fetched.chainId || 0), verifyingContract: fetched.verifyingContract || contractInstance.target };
                const types = { Evidence: [ { name:'caseId', type:'uint256' }, { name:'uploader', type:'address' }, { name:'contentDigest', type:'bytes32' } ] };
                const value = { caseId: BigInt(fetched.caseId || evCaseId), uploader: fetched.uploader, contentDigest: fetched.contentDigest };
                const recovered = verifyTypedData(domain, types, value, fetched.signature);
                sigValid = recovered.toLowerCase() === String(fetched.uploader).toLowerCase();
                if (!sigValid) status = status === 'pending' ? 'sig-invalid' : status;
              } catch (se) { sigValid = false; status = status === 'pending' ? 'sig-invalid' : status; }
            }
            if (status === 'pending') status = 'verified';
          }
        } catch (e) {
          if (status === 'pending') status = 'error';
        }
        return {
          caseId: evCaseId,
          cid,
          cidDigestEvent,
          cidDigestLocal,
          contentDigestLocal,
          fetched,
          submitter,
          status,
          sigValid,
          encrypted,
          txHash: ev?.transactionHash
        };
      }));
      setItems(enriched);
    } catch (e) {
      setError(e.message || String(e)); setItems([]);
    } finally { setLoading(false); }
  }, [contractInstance, caseId, heliaFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  return { evidence: items, loading, error, refresh };
}
