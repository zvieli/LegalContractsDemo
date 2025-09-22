import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EvidencePanel } from './ResolveModal.jsx'

// NOTE: This test imports the EvidencePanel default export path. The component
// is a named function inside ResolveModal.jsx. For test simplicity we will
// import by path and access the EvidencePanel via module default if available.

describe('EvidencePanel', () => {
  let originalFetch
  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn((url, opts) => {
      if (url.includes('/pin/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ meta: { filename: 'evidence.txt', size: 14 }, id: 'pin_test' }) })
      }
      if (url.includes('/admin/decrypt/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ decrypted: 'TEST EVIDENCE' }) })
      }
      return Promise.resolve({ ok: false })
    })
  })

  afterEach(() => { global.fetch = originalFetch })

  it('fetches pinned record and decrypts when admin key set', async () => {
    // set admin API key in localStorage so admin decrypt is allowed
  // admin key removed; tests should use signed reveal flows or mock server responses

    // Dummy signer that exposes signMessage returning a stable signature string
    const dummySigner = { signMessage: async (msg) => '0x' + Buffer.from('dummy').toString('hex') };

    // Render the EvidencePanel named export directly with dummy signer and contract address
    render(<EvidencePanel initialPinId="pin_test" isArbitrator={true} signer={dummySigner} contractAddress={'0x0000000000000000000000000000000000000000'} />)

    // click Fetch
    const fetchBtn = await screen.findByText('Fetch')
    fireEvent.click(fetchBtn)

    // pinned record should appear
    expect(await screen.findByText(/Filename:/)).toBeTruthy()

    // click Admin Decrypt
    const decBtn = screen.getByText('Admin Decrypt')
    fireEvent.click(decBtn)

    // decrypted content should appear
    expect(await screen.findByText('TEST EVIDENCE')).toBeTruthy()
  })
})
