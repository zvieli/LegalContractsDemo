import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import EvidenceUploader from '../components/EvidenceUploader';

// Note: this test runs against the real backend; do not mock fetch here.

describe('EvidenceUploader', () => {
  it('uploads a file and calls onComplete (integration)', async () => {
    const onComplete = vi.fn();
  const { getByText, getByLabelText } = render(React.createElement(EvidenceUploader, { onComplete }));
    const fileInput = getByLabelText(/select evidence file/i);

    const file = new File([JSON.stringify({ test: true })], 'test.json', { type: 'application/json' });

    // attach file
    Object.defineProperty(fileInput, 'files', { value: [file] });

    fireEvent.submit(getByText(/upload/i));

    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 10000 });
  });
});
