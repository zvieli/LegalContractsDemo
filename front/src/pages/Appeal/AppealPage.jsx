import React from 'react';
import AppealForm from '../../components/Appeal/AppealForm';
import './AppealPage.css';

export default function AppealPage() {
  // Read URL params: ?contractAddress=0x...&disputeId=123
  const params = new URLSearchParams(window.location.search || '');
  const contractAddress = params.get('contractAddress') || params.get('contract') || '';
  const disputeIdParam = params.get('disputeId') || params.get('id') || '';
  const disputeId = disputeIdParam ? Number(disputeIdParam) : 0;

  // Demo fallbacks if none provided
  const demoContractAddress = contractAddress || '';
  const demoDisputeId = disputeId || 0;

  return (
    <div className="appeal-page" data-testid="appeal-page-root">
      <div className="container">
        <h2>Appeal Dispute</h2>
        <AppealForm contractAddress={demoContractAddress} disputeId={demoDisputeId} />
      </div>
    </div>
  );
}
