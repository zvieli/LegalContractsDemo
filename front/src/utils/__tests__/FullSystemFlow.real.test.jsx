import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import EvidenceList from '../../components/Evidence/EvidenceList.jsx';
import BatchDashboardAdvanced from '../../components/Dashboard/BatchDashboardAdvanced.jsx';


const WALLETS = [ {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  }];

describe('Full System Flow (Integration)', () => {
  it('should run full Helia evidence flow (skeleton)', () => {
    // TODO:
    // 1. להתחבר עם MetaMask
    // 2. ליצור חוזה חדש דרך ה-UI (NDA/שכירות)
    // 3. להעלות ראיה ל-Helia ולקבל CID
    // 4. ליצור digest ולשלוח ל-smart contract
    // 5. לקבל אירועים מהחוזה ולעדכן את ה-UI
    // 6. להציג batch evidence, סטטוס, החלטות בוררות
  });
});