import React from 'react';
import EvidenceUploader from '../components/EvidenceUploader';

export default {
  title: 'Components/EvidenceUploader',
  component: EvidenceUploader
};

export const Default = () => (
  <EvidenceUploader onComplete={(res) => alert('Uploaded: ' + JSON.stringify(res))} onError={(e) => alert('Error: ' + String(e))} />
);
