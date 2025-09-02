import { useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { ethers } from 'ethers';
import mockContracts from '../../utils/contracts/MockContracts.json';
import './CreateRent.css';

function CreateRent() {
  // Mock Price Feed (loaded via static import so bundler includes it)
  const mockPriceFeedAddress = mockContracts?.contracts?.MockPriceFeed?.trim() || null;
  console.log('mockPriceFeedAddress:', mockPriceFeedAddress);

  const { account, signer, isConnected, chainId } = useEthers();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenantAddress: '',
    rentAmount: '',
    paymentToken: '0x0000000000000000000000000000000000000000',
    priceFeed: '0x694AA1769357215DE4FAC081bf1f309aDC325306', // ETH/USD Sepolia
    duration: '',
    startDate: '',
    network: 'sepolia' // Default
  });

  const resolveSelectedNetworkChainId = () => {
    switch (formData.network) {
      case 'mainnet': return 1;
      case 'goerli': return 5;
      case 'sepolia': return 11155111;
      case 'polygon': return 137;
      case 'localhost':
      default: return 31337;
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value.trim()
    }));
  };

  const handleCreateContract = async (e) => {
    e.preventDefault();

    if (!isConnected || !account || !signer) {
      alert('Please connect your wallet first');
      return;
    }

    // Validation
    if (!formData.tenantAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      alert('Please enter a valid Ethereum address');
      return;
    }
    if (!formData.rentAmount || parseFloat(formData.rentAmount) <= 0) {
      alert('Please enter a valid rent amount');
      return;
    }
    if (!formData.duration || parseInt(formData.duration) <= 0) {
      alert('Please enter a valid duration');
      return;
    }
    if (!formData.startDate) {
      alert('Please select a start date');
      return;
    }

    const expectedChainId = resolveSelectedNetworkChainId();
    const isLocalSelected = formData.network === 'localhost';
    if (!isLocalSelected && chainId && Number(chainId) !== expectedChainId) {
      alert(`Please switch your wallet network to match the selected network (expected chainId ${expectedChainId}, got ${chainId}).`);
      return;
    }

    setLoading(true);

    try {
      // Try to switch/add the user's wallet to the expected network (best-effort)
      if (typeof window !== 'undefined' && window.ethereum) {
        const hexChainId = `0x${expectedChainId.toString(16)}`;
        try {
          // If localhost selected, try to add the Hardhat/local network first
          if (isLocalSelected) {
            try {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: hexChainId,
                  chainName: 'Localhost (Hardhat)',
                  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                  rpcUrls: ['http://127.0.0.1:8545'],
                  blockExplorerUrls: []
                }]
              });
            } catch (addErr) {
              // ignore add error (may already exist or provider doesn't support add)
              console.warn('wallet_addEthereumChain failed or not supported:', addErr);
            }
          }

          // then attempt switch
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: hexChainId }]
          });
        } catch (switchError) {
          console.warn('Could not add/switch network programmatically:', switchError);
          alert('Please switch your wallet network to the selected network (e.g. Hardhat/Localhost) and try again.');
          setLoading(false);
          return;
        }
      }

      const contractService = new ContractService(signer, expectedChainId); // ✅ Use expectedChainId

      const params = {
        tenant: formData.tenantAddress,
        rentAmount: formData.rentAmount,
        paymentToken: formData.paymentToken,
        priceFeed: formData.priceFeed,
        duration: formData.duration,
        startDate: Math.floor(new Date(formData.startDate).getTime() / 1000),
        network: formData.network
      };

      const result = await contractService.createRentContract(params);

      if (result.contractAddress) {
        alert(`✅ Rent contract created successfully!\nContract Address: ${result.contractAddress}`);

        setFormData({
          tenantAddress: '',
          rentAmount: '',
          paymentToken: '0x0000000000000000000000000000000000000000',
          priceFeed: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
          duration: '',
          startDate: '',
          network: 'sepolia'
        });

        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 2000);
      } else {
        alert('⚠️ Contract creation pending. Please check your wallet for confirmation.');
      }
    } catch (error) {
      console.error('Error creating contract:', error);
      alert(`❌ Error: ${error.reason || error.message}\nFull error: ${JSON.stringify(error)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="create-rent-page">
        <div className="not-connected">
          <i className="fas fa-wallet"></i>
          <h2>Connect Your Wallet</h2>
          <p>Please connect your wallet to create a rental contract</p>
        </div>
      </div>
    );
  }

  return (
    <div className="create-rent-page">
      <div className="page-header">
        <h1>Create Rental Contract</h1>
        <p>Create a new smart rental agreement on the blockchain</p>
      </div>

      <div className="form-container">
        <form onSubmit={handleCreateContract} className="rent-form">
          {/* Network Selection */}
          <div className="form-group">
            <label htmlFor="network">Network *</label>
            <select
              id="network"
              name="network"
              value={formData.network}
              onChange={handleInputChange}
              required
            >
              <option value="sepolia">Sepolia Testnet</option>
              <option value="mainnet">Ethereum Mainnet</option>
              <option value="localhost">Localhost (Hardhat/Ganache)</option>
              <option value="goerli">Goerli Testnet</option>
              <option value="polygon">Polygon Mainnet</option>
            </select>
            <small>Select the blockchain network for deployment</small>
          </div>

          {/* Tenant Address */}
          <div className="form-group">
            <label htmlFor="tenantAddress">Tenant Address *</label>
            <input
              type="text"
              id="tenantAddress"
              name="tenantAddress"
              value={formData.tenantAddress}
              onChange={handleInputChange}
              placeholder="0x..."
              required
              pattern="^0x[a-fA-F0-9]{40}$"
            />
            <small>Ethereum address of the tenant</small>
          </div>

          {/* Rent Amount */}
          <div className="form-group">
            <label htmlFor="rentAmount">Rent Amount (ETH) *</label>
            <input
              type="number"
              id="rentAmount"
              name="rentAmount"
              value={formData.rentAmount}
              onChange={handleInputChange}
              placeholder="1.0"
              min="0.001"
              step="0.001"
              required
            />
            <small>Monthly rent amount in ETH</small>
          </div>

          {/* Payment Token */}
          <div className="form-group">
            <label htmlFor="paymentToken">Payment Token</label>
            <select
              id="paymentToken"
              name="paymentToken"
              value={formData.paymentToken}
              onChange={handleInputChange}
            >
              <option value="0x0000000000000000000000000000000000000000">ETH (Native)</option>
              <option value="0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984">USDC (Testnet)</option>
              <option value="0x6B175474E89094C44Da98b954EedeAC495271d0F">DAI (Testnet)</option>
            </select>
            <small>Token to be used for rent payments</small>
          </div>

          {/* Price Feed */}
          <div className="form-group">
            <label htmlFor="priceFeed">Price Feed Address *</label>
            <select
              id="priceFeed"
              name="priceFeed"
              value={formData.priceFeed}
              onChange={handleInputChange}
              required
            >
              <option value="0x694AA1769357215DE4FAC081bf1f309aDC325306">ETH/USD (Sepolia)</option>
              <option value="0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419">ETH/USD (Mainnet)</option>
              <option value="0xAb5c49580294Aff77670F839ea425f5b78ab3Ae7">USDC/USD (Mainnet)</option>
              {mockPriceFeedAddress && <option value={mockPriceFeedAddress}>Mock Price Feed (Local)</option>}
            </select>
            <small>Chainlink price feed for conversion rates</small>
          </div>

          {/* Duration */}
          <div className="form-group">
            <label htmlFor="duration">Contract Duration (Days) *</label>
            <input
              type="number"
              id="duration"
              name="duration"
              value={formData.duration}
              onChange={handleInputChange}
              min="1"
              max="365"
              required
            />
            <small>Duration of the rental agreement in days</small>
          </div>

          {/* Start Date */}
          <div className="form-group">
            <label htmlFor="startDate">Start Date *</label>
            <input
              type="date"
              id="startDate"
              name="startDate"
              value={formData.startDate}
              onChange={handleInputChange}
              required
            />
            <small>Start date of the rental period</small>
          </div>

          {/* Form Actions */}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => window.history.back()}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <div className="spinner"></div>
                  Creating Contract...
                </>
              ) : (
                <>
                  <i className="fas fa-plus"></i>
                  Create Rental Contract
                </>
              )}
            </button>
          </div>
        </form>

        {/* Contract Preview */}
        <div className="contract-preview">
          <h3>Contract Preview</h3>
          <div className="preview-content">
            <div className="preview-item">
              <span className="label">Network:</span>
              <span className="value">
                {formData.network === 'sepolia' && 'Sepolia Testnet'}
                {formData.network === 'mainnet' && 'Ethereum Mainnet'}
                {formData.network === 'localhost' && 'Local Network'}
                {formData.network === 'goerli' && 'Goerli Testnet'}
                {formData.network === 'polygon' && 'Polygon Mainnet'}
              </span>
            </div>
            <div className="preview-item">
              <span className="label">Landlord:</span>
              <span className="value">{account ? `${account.slice(0, 8)}...${account.slice(-6)}` : 'Not connected'}</span>
            </div>
            <div className="preview-item">
              <span className="label">Tenant:</span>
              <span className="value">{formData.tenantAddress ? `${formData.tenantAddress.slice(0, 8)}...${formData.tenantAddress.slice(-6)}` : 'Not specified'}</span>
            </div>
            <div className="preview-item">
              <span className="label">Rent Amount:</span>
              <span className="value">{formData.rentAmount ? `${formData.rentAmount} ETH` : 'Not specified'}</span>
            </div>
            <div className="preview-item">
              <span className="label">Duration:</span>
              <span className="value">{formData.duration ? `${formData.duration} days` : 'Not specified'}</span>
            </div>
            <div className="preview-item">
              <span className="label">Start Date:</span>
              <span className="value">{formData.startDate || 'Not specified'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateRent;
