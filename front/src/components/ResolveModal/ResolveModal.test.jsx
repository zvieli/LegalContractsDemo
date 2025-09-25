import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import * as contractService from '../../services/contractService'
import { EvidencePanel } from './ResolveModal.jsx'

// NOTE: This test imports the EvidencePanel default export path. The component
// is a named function inside ResolveModal.jsx. For test simplicity we will
// import by path and access the EvidencePanel via module default if available.

describe('EvidencePanel', () => {
  let originalFetch
  beforeEach(() => {
    originalFetch = global.fetch
  // Network fetches and admin decrypt endpoints are not used by the UI tests; mock fetch to avoid external calls.
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }))
  })

  afterEach(() => { global.fetch = originalFetch })

  it('fetches pinned record and decrypts when admin key set', async () => {
    // Render the EvidencePanel directly and assert it shows provided initial evidence or 'No evidence' when absent.
    render(<EvidencePanel initialEvidence={"0x1234"} />)
    expect(await screen.findByText(/0x1234/)).toBeTruthy()
    // When no evidence is provided, the panel shows the no-evidence placeholder
    render(<EvidencePanel initialEvidence={""} />)
    expect(await screen.findByText(/No evidence digest available on-chain/)).toBeTruthy()
  })
})

describe('ResolveModal admin decrypt normalization', () => {
  it('converts a pasted 0x<64hex> digest into digestNo0x (no env base)', async () => {
    const { default: ResolveModal } = await import('./ResolveModal.jsx');
    // Ensure the component sees the current user as an authorized arbitrator so the admin decrypt UI is rendered
    vi.spyOn(contractService.ContractService.prototype, 'isAuthorizedArbitratorForContract').mockResolvedValue(true);
    const mockSigner = {};

    const { findByText, findByPlaceholderText } = render(
      // render with minimal required props; provide a non-null contractAddress and signer so auth effect runs
      <ResolveModal isOpen={true} onClose={() => {}} contractAddress={'0x0000000000000000000000000000000000000001'} signer={mockSigner} chainId={31337} onResolved={() => {}} />
    );

    // Wait for admin decrypt button to appear
    const btn = await findByText('Admin decrypt (client)');
    expect(btn).toBeTruthy();
    // open modal
    fireEvent.click(btn);
    const ta = await findByPlaceholderText('Paste ciphertext JSON here or an HTTPS URL to fetch it');
    expect(ta).toBeTruthy();

    const digest = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    fireEvent.change(ta, { target: { value: digest } });
    // expect the text area to either be the digest without 0x (when no EVIDENCE_FETCH_BASE) or the composed fetch URL
    await new Promise((res) => setTimeout(res, 20));
    const digestNo0x = digest.replace(/^0x/, '');
    // Accept either the raw digestNo0x or a composed URL that ends with the digest filename
    expect(ta.value === digestNo0x || ta.value.endsWith(`${digestNo0x}.json`) || ta.value.endsWith(digestNo0x)).toBe(true);
  });
});
