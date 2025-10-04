import { useState, useEffect } from 'react';
import { computeCidDigest } from '../../utils/evidenceCanonical.js';
import { decryptEnvelopeWithPrivateKey } from '../../utils/clientDecrypt';
import { ethers } from 'ethers';

function EvidenceList({ contractAddress, onSelect }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [decryptKey, setDecryptKey] = useState('');
  const [decrypted, setDecrypted] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contractAddress) return;
    setLoading(true);
    fetch(`/evidence-index?contractAddress=${encodeURIComponent(contractAddress)}`)
      .then(r => r.json())
      .then(data => setEntries(Array.isArray(data) ? data : (data.entries || [])))
      .catch(e => { console.error('Failed to load evidence index', e); setEntries([]); })
      .finally(() => setLoading(false));
  }, [contractAddress]);

  const openEnvelope = async (digest) => {
    setSelected(digest);
    setDecrypted(null);
    setDecryptKey('');
  };

  const handleDecrypt = async () => {
    if (!selected) return;
    if (!decryptKey) return setDecryptError('Provide private key');
    setBusy(true);
    try {
      const res = await fetch(`/evidence/${selected}`);
      if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
      const envelope = await res.json();
      // Pre-check: derive address from private key and see if it matches any recipient
      try {
        let key = decryptKey.trim();
        if (key.startsWith('0x')) key = key;
        const wallet = new ethers.Wallet(key);
        const derived = (wallet.address || '').toLowerCase();
        const recipients = (envelope && envelope.envelope && envelope.envelope.recipients) ? envelope.envelope.recipients : (envelope && envelope.recipients ? envelope.recipients : []);
        const found = recipients.find(r => r && r.address && String(r.address).toLowerCase() === derived);
        if (!found) {
          setDecryptError('The provided private key does not match any recipient address in this envelope.');
          setBusy(false);
          return;
        }
      } catch (e) {
        // ignore and continue to attempt decrypt; wallet creation may fail for bad keys
      }
      // quick pre-check: derive public key from provided private key and try to match recipients
      try {
        const EthCrypto = await import('../../utils/clientDecrypt');
      } catch (e) {}
      try {
        const plain = await decryptEnvelopeWithPrivateKey(envelope.envelope || envelope, decryptKey);
        setDecrypted(plain);
        setDecryptError(null);
      } catch (e) {
        console.error('Decrypt failed', e);
        setDecrypted(null);
        setDecryptError(e.message || 'Decrypt failed');
      }
    } catch (e) {
      console.error('Fetch failed', e);
      setDecryptError('Failed fetching envelope: ' + (e.message || e));
    } finally { setBusy(false); }
  };

  return (
    <div className="section">
      <h4>Evidence</h4>
      {loading ? <div className="muted">Loading evidence...</div> : (
        <div>
          {entries.length === 0 ? <p className="muted">No evidence found for this contract.</p> : (
            <div className="transactions-list">
              {entries.map(e => {
                const cid = e.cid || e.CID || e.uri?.startsWith('ipfs://') ? e.uri?.replace('ipfs://','') : null;
                let verified = false;
                try { if (cid && e.digest) verified = computeCidDigest(cid) === e.digest; } catch(_) {}
                const encrypted = !!(e.encryption || e.ciphertext);
                return (
                <div key={e.digest} className="transaction-item" style={{display:'flex',flexDirection:'column',position:'relative'}}>
                  <div style={{position:'absolute',top:6,right:6,display:'flex',gap:6}}>
                    <span style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:'#eef'}}>{e.type||'evidence'}</span>
                    <span style={{padding:'2px 6px',borderRadius:4,fontSize:11,background: verified? '#d2f8d2':'#fdd'}}>{verified? 'Verified':'Invalid'}</span>
                    {encrypted && <span style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:'#ffe4b3'}}>Encrypted</span>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{flex:1}}>
                      <div><strong>Digest:</strong> {e.digest}</div>
                      <div><strong>Saved:</strong> {new Date(e.savedAt || Date.now()).toLocaleString()}</div>
                      <div><strong>CID:</strong> {cid || '—'}</div>
                      <div><strong>fileHash:</strong> {e.fileHash || '—'}</div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      <button className="btn-sm" onClick={() => { openEnvelope(e.digest); onSelect && onSelect(e); }}>View JSON</button>
                      <a className="btn-sm outline" href={e.uri || '#'} target="_blank" rel="noreferrer">Raw</a>
                      <button className="btn-sm outline" onClick={()=>{ try { const blob = new Blob([JSON.stringify(e,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`evidence-${e.digest.slice(2,10)}.json`; a.click(); } catch(_){} }}>Export</button>
                    </div>
                  </div>
                </div>
                ); })}
            </div>
          )}
        </div>
      )}

      {selected && (
        <div style={{marginTop:12,padding:10,border:'1px solid #eee',borderRadius:6}}>
          <h5>Envelope: {selected}</h5>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input className="text-input" type="password" placeholder="Private key (0x...)" value={decryptKey} onChange={e=>setDecryptKey(e.target.value)} />
            <button className="btn-primary" onClick={handleDecrypt} disabled={busy}>{busy ? 'Decrypting...' : 'Decrypt'}</button>
            <button className="btn-secondary" onClick={() => { setSelected(null); setDecrypted(null); setDecryptKey(''); }}>Close</button>
          </div>
            {decryptError && (<div style={{color:'crimson',marginTop:8}}>{decryptError}</div>)}
            {decrypted && (
            <div style={{marginTop:8}}>
              <h6>Decrypted</h6>
              <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default EvidenceList;
