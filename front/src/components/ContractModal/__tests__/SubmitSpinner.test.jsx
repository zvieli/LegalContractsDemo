import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, vi, expect } from 'vitest';

// A tiny test component that mimics the spinner area in ContractModal
function SpinnerTestComponent({ startFn }) {
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  const onClick = async () => {
    setSubmitting(true);
    setMsg('Collecting contract history and preparing evidence...');
    try {
      await startFn(() => setMsg('Submitting appeal to server...'));
    } finally {
      setSubmitting(false);
      setMsg(null);
    }
  };

  return (
    <div>
      <button onClick={onClick}>Trigger Submit</button>
      {msg && (
        <div aria-live="polite" style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
          <div className="submit-spinner" role="status" aria-label="Submitting"></div>
          <div className="spinner-label">{msg}</div>
        </div>
      )}
    </div>
  );
}

describe('spinner CSS and visibility', () => {
  it('renders submit-spinner while promise is pending', async () => {
    let resolve;
    const p = new Promise((res) => { resolve = res; });
    const fakeStart = vi.fn(() => p);

    render(<SpinnerTestComponent startFn={fakeStart} />);

  const btn = screen.getByText('Trigger Submit');
  const user = userEvent.setup();
  await user.click(btn);

  expect(fakeStart).toHaveBeenCalled();
    // spinner should appear
    expect(document.querySelector('.submit-spinner')).toBeTruthy();

    // resolve promise
    resolve(true);

    await waitFor(() => {
      expect(document.querySelector('.submit-spinner')).toBeFalsy();
    });
  });
});
    // At this point, the mocked startCancellationWithAppeal has been called but not resolved
