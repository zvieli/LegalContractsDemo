// front/src/services/v7Backend.js

const V7_API_BASE = '/api/v7';

export async function submitAppeal({ disputeId, contractAddress, appealReason, newEvidenceCID }) {
  const payload = {
    disputeId,
    contractAddress,
    appealReason,
    newEvidenceCID
  };
  const response = await fetch(`${V7_API_BASE}/dispute/appeal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await response.json();
}
