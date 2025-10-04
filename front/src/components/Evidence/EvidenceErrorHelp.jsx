import React from 'react';

const ERROR_HELP = {
  'sig-invalid': {
    title: 'Invalid Signature',
    description: 'The evidence signature could not be verified.',
    causes: [
      'Evidence was submitted by a different account than the signer',
      'Evidence content was modified after signing',
      'Signature was corrupted during transmission',
      'Wrong contract domain used during signing'
    ],
    actions: [
      'Contact the evidence submitter to verify authenticity',
      'Request the evidence to be re-submitted with proper signature',
      'If you submitted this evidence, try uploading again',
      'Check that your wallet was connected to the correct network'
    ],
    severity: 'critical'
  },
  'cid-mismatch': {
    title: 'CID Mismatch',
    description: 'The evidence content does not match its claimed identifier.',
    causes: [
      'Evidence was replaced after initial submission',
      'Gateway returned different content',
      'IPFS pinning inconsistency',
      'Network transmission error'
    ],
    actions: [
      'Try fetching from a different IPFS gateway',
      'Verify the CID independently using IPFS tools',
      'Contact the evidence submitter for clarification',
      'Use the "Open Evidence" viewer to test multiple gateways'
    ],
    severity: 'high'
  },
  'content-mismatch': {
    title: 'Content Digest Mismatch',
    description: 'The evidence content was modified after signing.',
    causes: [
      'JSON was reformatted or reordered after canonicalization',
      'Evidence envelope was tampered with',
      'Different canonicalization algorithm used',
      'Original content was corrupted'
    ],
    actions: [
      'Compare with the original evidence file if available',
      'Request fresh evidence submission',
      'Verify with other parties who may have copies',
      'Consider this evidence potentially compromised'
    ],
    severity: 'critical'
  },
  'fetch-failed': {
    title: 'Could Not Retrieve Evidence',
    description: 'The evidence could not be downloaded from off-chain storage.',
    causes: [
      'IPFS gateway is down or overloaded',
      'Content was unpinned from IPFS',
      'Network connectivity issues',
      'CID was recorded incorrectly'
    ],
    actions: [
      'Try the "Open Evidence" viewer with different gateways',
      'Check your internet connection',
      'Wait and try again later (temporary gateway issues)',
      'Contact the evidence submitter for an alternative copy'
    ],
    severity: 'medium'
  },
  error: {
    title: 'Verification Error',
    description: 'An unexpected error occurred during evidence verification.',
    causes: [
      'Network connectivity problems',
      'Malformed evidence data',
      'Client-side verification bug',
      'Unsupported evidence format'
    ],
    actions: [
      'Refresh the page and try again',
      'Check browser console for detailed error messages',
      'Try from a different device or browser',
      'Report the issue with evidence CID details'
    ],
    severity: 'medium'
  },
  pending: {
    title: 'Verification In Progress',
    description: 'Evidence is still being verified.',
    actions: [
      'Wait for verification to complete',
      'Refresh the page if it takes too long',
      'Check your network connection'
    ],
    severity: 'info'
  }
};

export default function EvidenceErrorHelp({ status, isOpen, onClose }) {
  if (!isOpen || !status || status === 'verified') return null;

  const info = ERROR_HELP[status] || ERROR_HELP['error'];
  const severityColors = {
    critical: '#d32f2f',
    high: '#f57500',
    medium: '#f9a825',
    info: '#1976d2'
  };

  return (
    <div className="modal">
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <span 
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: severityColors[info.severity] || severityColors.medium,
              color: 'white',
              fontWeight: 'bold',
              fontSize: '14px'
            }}
          >
            {info.severity?.toUpperCase() || 'ERROR'}
          </span>
          <h3 style={{ margin: 0 }}>{info.title}</h3>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <p style={{ fontSize: '14px', color: '#333', margin: '0 0 12px 0' }}>
            {info.description}
          </p>
        </div>

        {info.causes && (
          <div style={{ marginBottom: '16px' }}>
            <h5 style={{ margin: '0 0 8px 0', color: '#555' }}>Possible Causes:</h5>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#666' }}>
              {info.causes.map((cause, i) => (
                <li key={i} style={{ marginBottom: '4px' }}>{cause}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <h5 style={{ margin: '0 0 8px 0', color: '#555' }}>Recommended Actions:</h5>
          <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#666' }}>
            {info.actions.map((action, i) => (
              <li key={i} style={{ marginBottom: '4px' }}>{action}</li>
            ))}
          </ol>
        </div>

        {info.severity === 'critical' && (
          <div style={{
            padding: '12px',
            background: '#ffeaa7',
            border: '1px solid #fdcb6e',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            <strong>⚠️ Security Warning:</strong> This evidence may be compromised or forged. 
            Do not rely on it for important decisions until the issue is resolved.
          </div>
        )}

        <div style={{ 
          fontSize: '12px', 
          color: '#888', 
          marginBottom: '16px',
          padding: '8px',
          background: '#f8f9fa',
          borderRadius: '4px'
        }}>
          <strong>Need More Help?</strong><br/>
          • Check the Evidence Badge Legend for status explanations<br/>
          • Use "Open Evidence" to test different IPFS gateways<br/>
          • Contact support with the evidence CID for assistance
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}