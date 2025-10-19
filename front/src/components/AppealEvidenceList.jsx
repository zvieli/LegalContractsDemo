import React from 'react';

export default function AppealEvidenceList({ entries = [] }) {
  if (!entries || entries.length === 0) return <div className="muted">No persisted appeal evidence found for this contract.</div>;

  return (
    <ul style={{marginTop:8}}>
      {entries.map((it, idx) => {
        const ref = it.ref || '';
        const isHelia = /^helia:\/\//i.test(ref);
        const isIpfs = /^ipfs:\/\//i.test(ref);
        const maybeCid = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[0-9a-z]{10,})$/i.test(ref);
        let gatewayUrl = null;
        if (isHelia) {
          const cid = ref.replace(/^helia:\/\//i, '');
          gatewayUrl = `https://ipfs.io/ipfs/${cid}`;
        } else if (isIpfs) {
          const path = ref.replace(/^ipfs:\/\//i, '');
          gatewayUrl = `https://ipfs.io/ipfs/${path}`;
        } else if (maybeCid) {
          gatewayUrl = `https://ipfs.io/ipfs/${ref}`;
        }

        return (
          <li key={idx} style={{marginBottom:6, display:'flex', gap:8, alignItems:'center'}}>
            <div style={{flex:1, wordBreak:'break-all'}}>{ref}</div>
            <div style={{color:'#666',fontSize:12}}>{it.createdAt ? new Date(it.createdAt).toLocaleString() : ''}</div>
            <div style={{display:'flex', gap:6}}>
              {gatewayUrl && (
                <a className="btn-sm" href={gatewayUrl} target="_blank" rel="noreferrer">Open</a>
              )}
              <button className="btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(ref); alert('Copied'); } catch(e){ alert('Copy failed'); } }}>Copy</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
