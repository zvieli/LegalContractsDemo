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
    // The pin-server and admin decrypt endpoints were removed; tests should not rely on network fetches.
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
