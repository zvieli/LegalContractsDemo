import { useState } from 'react';
import { canonicalize, computeCidDigest, computeContentDigest } from '../../utils/evidenceCanonical.js';
import { buildEncryptedEnvelope, signEvidenceEIP712, hashRecipients } from '../../utils/evidence.js';
import { listRecipients } from '../../utils/recipientKeys.js';
import { addJson } from '../../utils/heliaClient.js';
import * as ethers from 'ethers';

// Props: { contract, onClose, onSubmitted, recipientsPubkeys (array hex), caseId }
export default function EvidenceUploadModal({ contract, caseId = 0, onClose, onSubmitted, recipientsPubkeys = [], signer }) {
  const [type, setType] = useState('generic');
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [signature, setSignature] = useState(null);
  const [encryptionFallback, setEncryptionFallback] = useState(false);

  const makeBaseObject = (uploader, chainId, verifyingContract) => ({
    version: 1,
    schema: 'ArbiTrustEvidenceV1',
    caseId,
    type,
    amountWei: amount ? ethers.parseEther(amount).toString() : null,
    narrative: text,
    createdAt: Date.now(),
    uploader,
    chainId,
    verifyingContract
  });

  async function buildPreview() {
    setError(null);
    setEncryptionFallback(false);
    try {
      if (!signer) throw new Error('Signer required to build evidence preview');
      const addr = await signer.getAddress();
      const net = await signer.provider.getNetwork();
      const verifyingContract = contract ? contract.target : ethers.ZeroAddress;
      const base = makeBaseObject(addr, Number(net.chainId), verifyingContract);
      const canon = canonicalize(base);
      const contentDigest = computeContentDigest(canon);
      let envelope = null;
      let targetRecipients = recipientsPubkeys;
      if (encrypt && (!targetRecipients || targetRecipients.length === 0)) {
        try {
          const seeded = listRecipients();
          targetRecipients = seeded.map(r => r.pubkey).filter(Boolean);
        } catch (_) { /* ignore */ }
      }
      if (encrypt && targetRecipients.length) {
        const { envelope: env } = await buildEncryptedEnvelope(base, targetRecipients);
        envelope = env;
        // Check for encryption failures
        const failedRecipients = env.recipients?.filter(r => !r.ok) || [];
        if (failedRecipients.length > 0) {
          setEncryptionFallback(true);
        }
      }
      setPreview({ base, contentDigest, envelope, targetRecipients: targetRecipients || [] });
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  async function signUploader() {
    if (!signer) return;
    if (!preview) return;
    try {
      const chain = await signer.provider.getNetwork();
      const evidenceData = {
        caseId: caseId,
        contentDigest: preview.contentDigest,
        recipients: preview.targetRecipients || [],
        cid: 'placeholder' // Will be replaced after upload
      };
      const contractInfo = {
        chainId: Number(chain.chainId),
        verifyingContract: contract.target
      };
      const sig = await signEvidenceEIP712(evidenceData, contractInfo, signer);
      setSignature(sig);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  async function submit() {
    if (!contract) return;
    if (!preview) return setError('Build preview first');
    if (!signature) return setError('Sign evidence first');
    setBusy(true); setError(null);
    try {
      let toStore = preview.envelope ? { ...preview.envelope } : { ...preview.base };
      toStore.caseId = caseId;
      toStore.contentDigest = preview.contentDigest;
      toStore.signature = signature;
      toStore.uploader = preview.base.uploader;
      toStore.chainId = preview.base.chainId;
      toStore.verifyingContract = preview.base.verifyingContract;
      
      const cid = await addJson(toStore);
      const cidDigest = computeCidDigest(cid);
      const recipientsHash = hashRecipients(preview.targetRecipients || []);
      
      // Try new secure method first
      let tx;
      if (typeof contract.submitEvidenceWithSignature === 'function') {
        // Re-sign with actual CID
        const chain = await signer.provider.getNetwork();
        const evidenceData = {
          caseId: caseId,
          contentDigest: preview.contentDigest,
          recipients: preview.targetRecipients || [],
          cid: cid
        };
        const contractInfo = {
          chainId: Number(chain.chainId),
          verifyingContract: contract.target
        };
        const finalSignature = await signEvidenceEIP712(evidenceData, contractInfo, signer);
        
        tx = await contract.submitEvidenceWithSignature(
          caseId, cid, preview.contentDigest, recipientsHash, finalSignature
        );
      } else {
        // Fallback to deprecated method (should not happen in production)
        setError('Warning: Using deprecated submission method without signature verification');
        return;
      }
      
      await tx.wait();
      onSubmitted && onSubmitted({ cid, cidDigest, caseId, txHash: tx.hash });
      onClose && onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>Upload Evidence</h3>
        <label>Type
          <select value={type} onChange={e=>setType(e.target.value)}>
            <option value="generic">Generic</option>
            <option value="damage">Damage</option>
            <option value="payment">Payment</option>
            <option value="communication">Communication</option>
          </select>
        </label>
        <label>Amount (ETH) <input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="optional"/></label>
        <label>Text
          <textarea value={text} onChange={e=>setText(e.target.value)} rows={4} />
        </label>
        <label style={{display:'flex',alignItems:'center',gap:6}}>
          <input type="checkbox" checked={encrypt} onChange={e=>setEncrypt(e.target.checked)} /> Encrypt envelope
        </label>
        {encryptionFallback && (
          <div style={{color:'orange', fontSize:'0.9em', marginTop:4}}>
            ⚠️ Some recipients failed encryption - envelope contains mixed plaintext/encrypted data
          </div>
        )}
        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button onClick={buildPreview} disabled={busy}>Build Preview</button>
          <button onClick={signUploader} disabled={!preview || busy}>Sign</button>
          <button onClick={submit} disabled={!preview || !signature || busy}>Submit</button>
          <button className="outline" onClick={()=> onClose && onClose()}>Close</button>
        </div>
        {busy && <div className="muted">Processing...</div>}
        {error && <div style={{color:'crimson'}}>{error}</div>}
        {preview && (
          <div style={{marginTop:12}}>
            <h5>Preview</h5>
            <pre style={{maxHeight:200,overflow:'auto'}}>{JSON.stringify(preview, null, 2)}</pre>
            {signature && <div style={{wordBreak:'break-all'}}><strong>Signature:</strong> {signature}</div>}
          </div>
        )}
      </div>
    </div>
  );
}