import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArbitrationPanel from '../ArbitrationPanel';
import * as api from '../../api/arbitration';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/arbitration');

describe('ArbitrationPanel UI', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('renders ai verdict and allows resubmit', async () => {
    const history = { entries: [ { type: 'DisputeReported', date: 'now', data: { complaint: 'cid:abc' }, aiDecision: { verdict: 'deny', rationale: 'Not enough evidence' } } ] };
    api.getDisputeHistory.mockResolvedValueOnce(history);
    api.requestArbitration.mockResolvedValueOnce({ requestId: 'r1' });
    api.triggerArbitrateBatch.mockResolvedValueOnce({ job: 'ok' });

    render(<ArbitrationPanel />);

    const input = screen.getByPlaceholderText(/Enter caseId/i);
    await userEvent.type(input, 'case-42');

    const loadBtn = screen.getByText('Load History');
    await userEvent.click(loadBtn);

    await waitFor(() => expect(api.getDisputeHistory).toHaveBeenCalledWith('case-42'));

    // AI verdict should appear
    await waitFor(() => expect(screen.getByText(/deny/i)).toBeTruthy());

    const resubmitBtn = screen.getByText('Resubmit Arbitration');
    await userEvent.click(resubmitBtn);

    await waitFor(() => expect(api.triggerArbitrateBatch).toHaveBeenCalled());

    // result summary should render after resubmit
    await waitFor(() => expect(screen.getByText(/Arbitration request submitted/i)).toBeTruthy());
  });
});
