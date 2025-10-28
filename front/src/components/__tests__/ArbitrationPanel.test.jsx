import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArbitrationPanel from '../ArbitrationPanel';
import * as api from '../../api/arbitration';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/arbitration');

describe('ArbitrationPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads history and requests arbitration', async () => {
    api.getDisputeHistory.mockResolvedValueOnce({ entries: [] });
    api.requestArbitration.mockResolvedValueOnce({ requestId: 'r1' });
    api.getDisputeHistory.mockResolvedValueOnce({ entries: [], aiDecision: { verdict: 'ok' } });

    render(<ArbitrationPanel />);

    const input = screen.getByPlaceholderText(/Enter caseId/i);
    await userEvent.type(input, 'case-1');

    const loadBtn = screen.getByText('Load History');
    await userEvent.click(loadBtn);

    await waitFor(() => expect(api.getDisputeHistory).toHaveBeenCalledWith('case-1'));

    const reqBtn = screen.getByText('Request Arbitration');
    await userEvent.click(reqBtn);

    await waitFor(() => expect(api.requestArbitration).toHaveBeenCalledWith('case-1'));

    // since polling will call getDisputeHistory again and find aiDecision
    await waitFor(() => expect(screen.getByText(/Dispute History/)).toBeTruthy());
  });
});
