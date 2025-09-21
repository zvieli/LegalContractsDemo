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
    localStorage.setItem('PIN_SERVER_API_KEY', 'admin')

  // Render the EvidencePanel named export directly
  render(<EvidencePanel initialPinId="pin_test" isArbitrator={true} />)

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
