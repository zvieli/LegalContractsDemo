import { useEthers } from '../../contexts/EthersContext'

export default function Dashboard() {
  const { isConnected, account } = useEthers()

  if (!isConnected) {
    return (
      <div className="dashboard-not-connected">
        <p>Please connect your wallet to view your contracts</p>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <h3>Your Contracts</h3>
      <p>Connected account: {account}</p>
      <div className="contracts-list">
        {/* כאן נוסיף later את רשימת החוזים */}
        <p>No contracts yet. Create your first contract!</p>
      </div>
    </div>
  )
}