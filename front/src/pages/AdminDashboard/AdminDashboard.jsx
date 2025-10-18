import React, { useState, useEffect, useContext } from 'react';
import { ethers } from 'ethers';
import { useEthers } from '../../contexts/EthersContext';
import { getContractABI } from '../../utils/contracts';

const ARBITRATION_SERVICE_ADDRESS = import.meta.env?.VITE_ARBITRATION_SERVICE_ADDRESS || '';

export default function AdminDashboard() {
  const { provider, signer, account, chainId, isConnected } = useEthers();
  const [adminAddress, setAdminAddress] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [totalDai, setTotalDai] = useState('0');
  const [totalEth, setTotalEth] = useState('0');
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawToken, setWithdrawToken] = useState('DAI');
  const [syncTime, setSyncTime] = useState('');
  const [syncError, setSyncError] = useState(null);
  const [pendingWithdraw, setPendingWithdraw] = useState(false);

  // Fetch admin address and bond transactions from ArbitrationService contract
  useEffect(() => {
    async function syncData() {
      setSyncError(null);
      setSyncTime(new Date().toLocaleString('en-GB'));
      try {
        if (!provider || !chainId || !ARBITRATION_SERVICE_ADDRESS) return;
        const abi = getContractABI('ArbitrationService');
        const contract = new ethers.Contract(ARBITRATION_SERVICE_ADDRESS, abi, provider);
        // Fetch owner (admin)
        const owner = await contract.owner();
        setAdminAddress(owner);
        // Fetch PaymentWithdrawn events (simulate bond transactions)
        // You may need to adjust event name and args to match your contract
        const filter = contract.filters.ResolutionApplied();
        let events = [];
        try {
          const cs = new (await import('../../services/contractService')).ContractService(provider, signer, chainId);
          const rp = cs._providerForRead() || provider;
          const readContract = new ethers.Contract(ARBITRATION_SERVICE_ADDRESS, abi, rp);
          events = await readContract.queryFilter(filter, -10000);
        } catch (e) {
          // fallback to provider-bound contract
          events = await contract.queryFilter(filter, -10000);
        }
        const txs = events.map((ev, idx) => ({
          id: idx + 1,
          date: new Date(ev.blockTimestamp * 1000).toLocaleString('en-GB'),
          amount: ethers.formatEther(ev.args.appliedAmount),
          token: 'ETH', // TODO: detect DAI if relevant
          contract: ev.args.target,
          sender: ev.args.caller
        }));
        setTransactions(txs);
        // Sum ETH/DAI
        let ethSum = 0, daiSum = 0;
        txs.forEach(tx => {
          if (tx.token === 'ETH') ethSum += parseFloat(tx.amount);
          if (tx.token === 'DAI') daiSum += parseFloat(tx.amount);
        });
        setTotalEth(ethSum.toFixed(4));
        setTotalDai(daiSum.toFixed(2));
      } catch (err) {
        setSyncError('Failed to sync: ' + err.message);
      }
    }
    syncData();
  }, [provider, chainId]);

  // Withdraw logic
  const handleWithdraw = async () => {
    setPendingWithdraw(true);
    try {
      if (!signer) throw new Error('Wallet not connected');
      if (!ethers.isAddress(withdrawAddress)) throw new Error('Invalid address');
      if (parseFloat(withdrawAmount) <= 0) throw new Error('Amount must be positive');
      // TODO: check available balance
      // Call withdrawPayments or custom withdrawal method
      // Example for ETH:
      // const tx = await signer.sendTransaction({ to: withdrawAddress, value: ethers.parseEther(withdrawAmount) });
      // await tx.wait();
      // For DAI, use ERC20 transfer
      // Show notification, update UI
      setWithdrawModalOpen(false);
      setWithdrawAddress('');
      setWithdrawAmount('');
      setWithdrawToken('DAI');
    } catch (err) {
      alert('Withdrawal failed: ' + err.message);
    }
    setPendingWithdraw(false);
  };

  return (
    <div className="admin-dashboard" data-testid="admin-dashboard" style={{
      minHeight: '100vh',
      width: '100%',
      background: 'linear-gradient(135deg, #e0aaff 0%, #ff6f91 100%)',
      padding: '48px 0',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
    }}>
      {/* Blockchain Sync Status */}
      <div className="sync-status" data-testid="sync-status" style={{
        color: '#fff',
        fontWeight: 500,
        fontSize: '1.1rem',
        marginBottom: 12,
        textAlign: 'center',
      }}>
        <span>Last Synced: {syncTime}</span>
        {syncError && <span style={{ color: '#ff3b3b', marginLeft: 12 }}>Sync Error!</span>}
        <button onClick={() => setSyncTime(new Date().toLocaleString('en-GB'))} data-testid="refresh-sync-btn" style={{
          marginLeft: 16,
          background: '#fff',
          color: '#ff6f91',
          border: 'none',
          borderRadius: 6,
          padding: '4px 12px',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(255,111,145,0.10)'
        }}>Refresh</button>
      </div>
      <div style={{ margin: '1rem 0', fontSize: '1rem', color: '#fff', textAlign: 'center' }}>
        Admin Address: <code style={{ color: '#fff', background: 'rgba(0,0,0,0.10)', borderRadius: 6, padding: '2px 8px' }}>{adminAddress}</code>
      </div>
      {/* Summary */}
      <div className="summary" style={{
        display: 'flex',
        gap: '4rem',
        margin: '2.5rem 0',
        justifyContent: 'center',
        width: '100%',
        maxWidth: 900,
      }}>
        <div className="summary-card" data-testid="summary-dai" style={{
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 18,
          padding: '32px 24px',
          minWidth: 220,
          textAlign: 'center',
          boxShadow: '0 2px 12px rgba(224,170,255,0.10)',
        }}>
          <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff' }}>Total Collected (DAI)</span>
          <div style={{ fontSize: '2.2rem', color: '#6366f1', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M16 2L16 30" stroke="#6366f1" strokeWidth="2"/><path d="M16 2L28 16L16 30L4 16L16 2Z" stroke="#6366f1" strokeWidth="2"/></svg>
            {totalDai} <span style={{ fontSize: '1.1rem', color: '#6366f1', marginLeft: 4 }}>DAI</span>
          </div>
        </div>
        <div className="summary-card" data-testid="summary-eth" style={{
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 18,
          padding: '32px 24px',
          minWidth: 220,
          textAlign: 'center',
          boxShadow: '0 2px 12px rgba(16,185,129,0.10)',
        }}>
          <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fff' }}>Total Collected (ETH)</span>
          <div style={{ fontSize: '2.2rem', color: '#10b981', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M16 2L16 30" stroke="#10b981" strokeWidth="2"/><path d="M16 2L28 16L16 30L4 16L16 2Z" stroke="#10b981" strokeWidth="2"/></svg>
            {totalEth} <span style={{ fontSize: '1.1rem', color: '#10b981', marginLeft: 4 }}>ETH</span>
          </div>
        </div>
      </div>
      {/* Transactions Table */}
      <div className="transactions-section" style={{
        marginBottom: '2rem',
        width: '100%',
        maxWidth: 900,
        background: 'rgba(255,255,255,0.10)',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(255,111,145,0.08)',
        padding: '24px 18px',
      }}>
        <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '1.25rem', marginBottom: 18 }}>Bond Transactions</h3>
        <table className="transactions-table" data-testid="transactions-table" style={{ width: '100%', borderCollapse: 'collapse', color: '#fff', fontSize: '1rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #fff', opacity: 0.8 }}>
              <th style={{ padding: '8px 0', fontWeight: 700 }}>Date</th>
              <th style={{ padding: '8px 0', fontWeight: 700 }}>Amount</th>
              <th style={{ padding: '8px 0', fontWeight: 700 }}>Token</th>
              <th style={{ padding: '8px 0', fontWeight: 700 }}>Contract</th>
              <th style={{ padding: '8px 0', fontWeight: 700 }}>Sender</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px 0', color: '#fff', opacity: 0.7 }}>No transactions yet</td></tr>
            ) : transactions.map(tx => (
              <tr key={tx.id} style={{ borderBottom: '1px solid #fff', opacity: 0.85 }}>
                <td style={{ padding: '8px 0' }}>{tx.date}</td>
                <td style={{ padding: '8px 0' }}>{tx.amount}</td>
                <td style={{ padding: '8px 0', fontWeight: 'bold' }}>{tx.token}</td>
                <td style={{ padding: '8px 0' }}><code style={{ color: '#fff', background: 'rgba(0,0,0,0.10)', borderRadius: 6, padding: '2px 8px' }}>{tx.contract}</code></td>
                <td style={{ padding: '8px 0' }}><code style={{ color: '#fff', background: 'rgba(0,0,0,0.10)', borderRadius: 6, padding: '2px 8px' }}>{tx.sender}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Withdraw Section */}
      <div className="withdraw-section" style={{
        marginBottom: '2rem',
        width: '100%',
        maxWidth: 400,
        background: 'rgba(255,255,255,0.13)',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(224,170,255,0.10)',
        padding: '24px 18px',
        textAlign: 'center',
      }}>
        <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '1.15rem', marginBottom: 18 }}>Withdraw Funds</h3>
        <button className="btn-primary" data-testid="open-withdraw-modal" onClick={() => setWithdrawModalOpen(true)} style={{
          background: 'linear-gradient(90deg, #6366f1 0%, #ff6f91 100%)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '10px 32px',
          fontWeight: 700,
          fontSize: '1.1rem',
          boxShadow: '0 2px 8px rgba(99,102,241,0.10)',
          cursor: 'pointer',
          marginTop: 8,
        }}>
          Withdraw
        </button>
      </div>
      {/* Withdraw Modal */}
      {withdrawModalOpen && (
        <div className="modal" data-testid="withdraw-modal" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="modal-content" style={{ background: '#fff', padding: 32, borderRadius: 16, minWidth: 340, boxShadow: '0 2px 24px rgba(99,102,241,0.15)' }}>
            <h3 style={{ color: '#6366f1', fontWeight: 700, fontSize: '1.15rem', marginBottom: 18 }}>Withdraw Funds</h3>
            <label style={{ fontWeight: 600, color: '#6366f1' }}>Destination Address:</label>
            <input type="text" value={withdrawAddress} onChange={e => setWithdrawAddress(e.target.value)} data-testid="withdraw-address-input" style={{ width: '100%', marginBottom: 12, borderRadius: 8, border: '1px solid #e0aaff', padding: '8px', fontSize: '1rem' }} />
            <label style={{ fontWeight: 600, color: '#6366f1' }}>Amount:</label>
            <input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} data-testid="withdraw-amount-input" style={{ width: '100%', marginBottom: 12, borderRadius: 8, border: '1px solid #e0aaff', padding: '8px', fontSize: '1rem' }} />
            <label style={{ fontWeight: 600, color: '#6366f1' }}>Token:</label>
            <select value={withdrawToken} onChange={e => setWithdrawToken(e.target.value)} data-testid="withdraw-token-select" style={{ width: '100%', marginBottom: 12, borderRadius: 8, border: '1px solid #e0aaff', padding: '8px', fontSize: '1rem' }}>
              <option value="DAI">DAI</option>
              <option value="ETH">ETH</option>
            </select>
            <button className="btn-primary" data-testid="confirm-withdraw-btn" onClick={handleWithdraw} style={{ width: '100%', marginTop: 16, background: 'linear-gradient(90deg, #6366f1 0%, #ff6f91 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 700, fontSize: '1.1rem', boxShadow: '0 2px 8px rgba(99,102,241,0.10)', cursor: 'pointer' }} disabled={pendingWithdraw}>
              {pendingWithdraw ? 'Processing...' : 'Confirm Withdrawal'}
            </button>
            <button className="btn-secondary" onClick={() => setWithdrawModalOpen(false)} style={{ width: '100%', marginTop: 8, background: '#e0aaff', color: '#6366f1', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
