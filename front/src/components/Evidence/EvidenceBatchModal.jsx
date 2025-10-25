import React from 'react';
import { keccak256 } from 'ethers';
import { addBytesToHelia } from '../../utils/heliaClient';
import { computeMerkleRoot, computeEvidenceLeaf, generateMerkleProof } from '../../utils/merkleHelper';
import { useNotifications } from '../../contexts/NotificationContext.jsx';

/**
 * EvidenceBatchModal
 * Implements batch evidence staging:
 *  - User selects multiple files (plaintext for now)
 *  - For each: compute contentDigest = keccak256(rawBytes)
 *  - Store raw bytes to Helia => CID
 *  - cidHash = keccak256(utf8Bytes(CID))
 *  - Maintain array of items (filename, size, cid, contentDigest, cidHash, caseId, timestamp, leaf)
 *  - Compute Merkle root over FULL struct leaf hashes (abi.encode(caseId, contentDigest, cidHash, uploader, timestamp))
 *  - On submit: call onSubmit({ root, count, items, leaves })
 */
export default function EvidenceBatchModal({ onClose, onSubmit, uploaderAddress, caseId }) {
  const [files, setFiles] = React.useState([]); // { id, name, size, bytes, contentDigest, cid, cidHash, caseId, timestamp, leaf, status, error }
  const [busy, setBusy] = React.useState(false);
  const [root, setRoot] = React.useState(null);
  const { addNotification } = useNotifications();

  // Recompute root whenever leaf hashes defined
  React.useEffect(() => {
    const leaves = files.filter(f => f.leaf).map(f => f.leaf);
    if (leaves.length === 0) { setRoot(null); return; }
    const r = computeMerkleRoot(leaves);
    setRoot(r);
  }, [files]);

  async function handleFilePick(e) {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    const additions = await Promise.all(list.map(async f => {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const contentDigest = keccak256(bytes);
      const caseIdBig = BigInt(caseId ?? 0n);
      const timestamp = BigInt(Math.floor(Date.now()/1000));
      return {
        id: Math.random().toString(36).slice(2),
        name: f.name,
        size: f.size,
        bytes,
        contentDigest,
        cid: null,
        cidHash: null,
        caseId: caseIdBig,
        timestamp,
        leaf: null,
        status: 'staged',
        error: null
      };
    }));
    setFiles(prev => [...prev, ...additions]);
    e.target.value = '';
  }

  async function persistToHelia(fileObj) {
    if (fileObj.cid) return fileObj; // already stored
    try {
      const cid = await addBytesToHelia(fileObj.bytes);
      const cidBytes = new TextEncoder().encode(cid);
      const cidHash = keccak256(cidBytes);
      // compute leaf now that cidHash known
      let leaf = null;
      try {
        leaf = computeEvidenceLeaf({
          caseId: fileObj.caseId,
          contentDigest: fileObj.contentDigest,
          cidHash,
          uploader: uploaderAddress || '0x0000000000000000000000000000000000000000',
          timestamp: fileObj.timestamp
        });
      } catch (e) { void e;/* keep null if failure */}
      // Remove raw bytes after hashing to save memory
      return { ...fileObj, cid, cidHash, leaf, bytes: undefined, status: 'stored' };
    } catch (e) { void e;
      return { ...fileObj, status: 'error', error: e?.message || String(e) };
    }
  }

  async function storeAll() {
    setBusy(true);
    try {
      const updated = [];
      for (const f of files) {
        updated.push(await persistToHelia(f));
      }
      setFiles(updated);
    } finally { setBusy(false); }
  }

  async function submitBatch() {
    if (!root) { addNotification({ type:'error', title:'No Root', message:'Add files before submitting' }); return; }
    if (files.some(f => !f.cid)) {
      if (!window.confirm('Some files not stored to Helia yet. Store all now?')) return;
      await storeAll();
    }
    const leaves = files.map(f => f.leaf).filter(Boolean);
    if (leaves.length !== files.length) {
      addNotification({ type:'error', title:'Leaf Missing', message:'Ensure all files stored first' });
      return;
    }
    addNotification({ type:'info', title:'Submitting Batch', message:`Root ${root.slice(0,10)}… count=${leaves.length}` });
    onSubmit && onSubmit({ root, count: leaves.length, items: files, leaves });
  }

  function removeFile(id) { setFiles(f => f.filter(x => x.id !== id)); }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'4vh 2vw', zIndex:2000}}>
      <div style={{background:'#fff', width:'min(1100px,100%)', borderRadius:10, padding:20, boxShadow:'0 4px 18px rgba(0,0,0,0.25)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
          <h2 style={{margin:0, fontSize:20}}>Batch Evidence Submission</h2>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <p style={{marginTop:0, fontSize:13, lineHeight:1.5}}>
          Add plaintext evidence files. Each file is stored on Helia/IPFS. We compute a Merkle root over just the content digests (keccak256 of raw bytes). On-chain we submit only the root and item count. CIDs are discoverable off-chain.
        </p>
        <div style={{marginBottom:12}}>
          <input type="file" multiple onChange={handleFilePick} />
          <button type="button" className="btn-sm" style={{marginLeft:8}} disabled={!files.length || busy} onClick={storeAll}>Store all to Helia</button>
          <button type="button" className="btn-sm primary" style={{marginLeft:8}} disabled={!root || busy} onClick={submitBatch}>Submit batch</button>
        </div>
        <div style={{fontSize:12, marginBottom:12}}>
          Total items: {files.length} {root && (<><span style={{marginLeft:12}}>Merkle Root:</span> <code style={{background:'#f5f5f5', padding:'2px 4px'}}>{root}</code></>)}
        </div>
        <div style={{maxHeight:'50vh', overflow:'auto', border:'1px solid #ddd', borderRadius:6}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                <th style={{textAlign:'left', padding:6}}>Name</th>
                <th style={{textAlign:'left', padding:6}}>Size</th>
                <th style={{textAlign:'left', padding:6}}>CID</th>
                <th style={{textAlign:'left', padding:6}}>Content Digest</th>
                <th style={{textAlign:'left', padding:6}}>Leaf Hash</th>
                <th style={{textAlign:'left', padding:6}}>Proof</th>
                <th style={{textAlign:'left', padding:6}}>Status</th>
                <th style={{textAlign:'left', padding:6}}></th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f.id} style={{borderTop:'1px solid #eee'}}>
                  <td style={{padding:6, maxWidth:220, wordBreak:'break-all'}}>{f.name}</td>
                  <td style={{padding:6}}>{f.size}</td>
                  <td style={{padding:6, maxWidth:260, wordBreak:'break-all'}}>{f.cid ? <code>{f.cid}</code> : <span style={{color:'#999'}}>—</span>}</td>
                    <td style={{padding:6, maxWidth:260, wordBreak:'break-all'}}>
                      {f.cid ? (
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          <code>{f.cid}</code>
                          <div style={{fontSize:11}}>
                            <a href={`/api/evidence/retrieve/${f.cid}`} target="_blank" rel="noreferrer">View via API</a>
                          </div>
                        </div>
                      ) : <span style={{color:'#999'}}>—</span>}
                    </td>
                  <td style={{padding:6, maxWidth:260, wordBreak:'break-all'}}><code>{f.contentDigest}</code></td>
                  <td style={{padding:6, maxWidth:260, wordBreak:'break-all'}}>{f.leaf ? <code>{f.leaf}</code> : <span style={{color:'#bbb'}}>—</span>}</td>
                  <td style={{padding:6}}>
                    {f.leaf && root && (
                      <button className="btn-xs" disabled={busy} onClick={() => {
                        try {
                          const leaves = files.map(x => x.leaf).filter(Boolean);
                          const idx = files.findIndex(x => x.id === f.id);
                          const proof = generateMerkleProof(leaves, idx);
                          const payload = {
                            root,
                            leaf: f.leaf,
                            caseId: f.caseId.toString(),
                            contentDigest: f.contentDigest,
                            cidHash: f.cidHash,
                            uploader: uploaderAddress,
                            timestamp: f.timestamp.toString(),
                            proof
                          };
                          const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `evidence-proof-${idx}.json`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          setTimeout(()=> URL.revokeObjectURL(url), 1500);
                          addNotification({ type:'success', title:'Proof Generated', message:`Proof for item #${idx}` });
                        } catch (e) { void e; addNotification({ type:'error', title:'Proof Error', message:(e?.message||String(e)) }); }
                      }}>Generate Proof</button>
                    )}
                  </td>
                  <td style={{padding:6}}>{f.status === 'error' ? <span style={{color:'crimson'}} title={f.error}>error</span> : f.status}</td>
                  <td style={{padding:6}}>
                    <button className="btn-xs" disabled={busy} onClick={() => removeFile(f.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {!files.length && (
                <tr>
                  <td colSpan={8} style={{padding:16, textAlign:'center', color:'#777'}}>No files added</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:12, fontSize:11, color:'#555'}}>
          Root derivation: deterministic pair-hash with lexicographically ordered pairs and last-node duplication when odd.
        </div>
      </div>
    </div>
  );
}
