import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import * as ethers from 'ethers';
import './CreateRent.css';
import '../../styles/notAllowed.css';

function CreateRent() {
  const { account, signer, isConnected, chainId } = useEthers();
  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
  const [loading, setLoading] = useState(false);
  // Canonical ETH/USD feed addresses (Chainlink)
  const FEEDS = {
    mainnet: '0x5f4eC3Df9cbd43714FE2740f5E3616155C5b8419',
    sepolia: '0x694AA1769357215DE4FAC081bf1f309aDC325306'
  };

  const [formData, setFormData] = useState({
    tenantAddress: '',
    rentAmount: '',
    // Start with empty; we'll auto-populate based on selected network below
    priceFeed: '',
    duration: '',
    startDate: '',
    network: 'localhost' // Default to localhost for developer workflows
  });
  const [createdContractAddress, setCreatedContractAddress] = useState('');

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
    setFormData(prev => ({ ...prev, [name]: value.trim() }));
  };

  // Whenever network selection changes, choose an appropriate default price feed if current one is empty or mismatched
  useEffect(() => {
    (async () => {
      const net = formData.network;
      // If user already typed a feed, leave it (unless it's the wrong Sepolia feed on localhost)
      let current = formData.priceFeed;
      const normalize = v => (v || '').toLowerCase();
      const isEmpty = !current || current.trim() === '';
      if (net === 'sepolia') {
        const target = FEEDS.sepolia;
        if (isEmpty || normalize(current) === normalize(FEEDS.mainnet)) {
          setFormData(prev => ({ ...prev, priceFeed: target }));
        }
      } else if (net === 'mainnet') {
        const target = FEEDS.mainnet;
        if (isEmpty || normalize(current) === normalize(FEEDS.sepolia)) {
          setFormData(prev => ({ ...prev, priceFeed: target }));
        }
      } else if (net === 'localhost') {
        // Attempt fork detection: if mainnet feed has code at local node, use mainnet feed; else leave empty and user can pick mock
        try {
          if (signer && signer.provider) {
            const code = await signer.provider.getCode(FEEDS.mainnet).catch(() => '0x');
            if (code && code !== '0x') {
              if (isEmpty || normalize(current) === normalize(FEEDS.sepolia)) {
                setFormData(prev => ({ ...prev, priceFeed: FEEDS.mainnet }));
              }
              return;
            }
          }
          // Fallback: if still empty and not a fork, keep Sepolia feed out (no code) to force user to choose a mock or deployed local feed
          if (isEmpty) {
            setFormData(prev => ({ ...prev, priceFeed: '' }));
          }
        } catch (_) {}
      }
    })();
  // Re-run when signer or chainId ready, not only network selection
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.network, signer, chainId]);

  // Manual feed detection helper (user-invoked)
  async function manualDetectFeed() {
    try {
      if (!signer) return;
      if (formData.network === 'localhost') {
        const code = await signer.provider.getCode(FEEDS.mainnet).catch(() => '0x');
        if (code && code !== '0x') {
          setFormData(prev => ({ ...prev, priceFeed: FEEDS.mainnet }));
          alert('Detected mainnet ETH/USD feed on local fork and applied it.');
          return;
        }
        alert('Mainnet feed not detected on localhost. Deploy a mock AggregatorV3 and paste its address.');
      } else if (formData.network === 'sepolia') {
        setFormData(prev => ({ ...prev, priceFeed: FEEDS.sepolia }));
      } else if (formData.network === 'mainnet') {
        setFormData(prev => ({ ...prev, priceFeed: FEEDS.mainnet }));
      }
    } catch (e) {
      console.warn('manualDetectFeed failed', e);
    }
  }

  // Ensure provider network is stable after a wallet network switch (ethers BrowserProvider may briefly report a stale chainId)
  async function ensureStableNetwork(expectedChainId, maxWaitMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const net = await signer?.provider?.getNetwork();
        if (net && Number(net.chainId) === Number(expectedChainId)) return true;
      } catch (e) {
        const msg = String(e?.message || '');
        if (/network changed/i.test(msg)) {
          // brief backoff then retry
        }
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  }

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

      // Wait for a stable provider network after switch
      const stable = await ensureStableNetwork(expectedChainId, 6000);
      if (!stable) {
        try {
          const providerNetwork = await signer.provider.getNetwork();
          alert(`Provider network still unstable or mismatched (expected ${expectedChainId}, got ${providerNetwork.chainId}). Please retry after your wallet finishes switching.`);
        } catch (_) {
          alert('Provider network not ready. Please retry in a moment.');
        }
        setLoading(false);
        return;
      }

      // Localhost convenience: if user left priceFeed empty, try auto-detection (mainnet fork) else instruct user
      if (formData.network === 'localhost') {
        let pf = formData.priceFeed;
        if (!pf || pf.trim() === '') {
          // Try mainnet feed (fork) again
            const code = await signer.provider.getCode(FEEDS.mainnet).catch(() => '0x');
            if (code && code !== '0x') {
              pf = FEEDS.mainnet;
              setFormData(prev => ({ ...prev, priceFeed: pf }));
            } else {
              alert('No local price feed detected. Deploy or configure a mock price feed, then paste its address.');
              setLoading(false);
              return;
            }
        }
      }

      const contractService = new ContractService(signer, expectedChainId); // ✅ Use expectedChainId

      const params = {
        tenant: formData.tenantAddress,
        rentAmount: formData.rentAmount,
        priceFeed: formData.priceFeed,
        duration: formData.duration,
        startDate: Math.floor(new Date(formData.startDate).getTime() / 1000),
        network: formData.network
      };

      const result = await contractService.createRentContract(params);

      if (result.contractAddress) {
        alert(`✅ Rent contract created successfully!\nContract Address: ${result.contractAddress}`);

        // keep the created contract address so the user can immediately Approve / Pay
        setCreatedContractAddress(result.contractAddress);

        // reset some form fields but keep network/payment selection so user can approve/pay
        setFormData((prev) => ({
          ...prev,
          tenantAddress: '',
          rentAmount: '',
          duration: '',
          startDate: ''
        }));
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

  // ERC20 support removed: token approval and token payment UI removed

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

  // If connected account is the configured platform admin, disallow creation via UI
  if (isAdmin) {
    return (
      <div className="create-rent-page">
        <div className="not-allowed">
          <i className="fas fa-ban"></i>
          <h2>Action Not Allowed</h2>
          <p>The connected account is registered as the platform admin and cannot create Rental contracts through this UI.</p>
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
            <div style={{ marginTop: '6px' }}>
              <button type="button" className="btn-secondary" onClick={manualDetectFeed}>Auto Detect Price Feed</button>
            </div>
          </div>

          {/* Tenant Address */}
          <div className="form-group">
            <label htmlFor="tenantAddress">Tenant Address *</label>
            <input
              type="text"
              id="tenantAddress"
              name="tenantAddress"
              data-testid="input-partyb-address"
              value={formData.tenantAddress}
              onChange={handleInputChange}
              placeholder="0x..."
              required
              pattern="^0x[a-fA-F0-9]{40}$"
            />
            <small>Ethereum address of the tenant</small>
            <div style={{ marginTop: '6px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setFormData(prev => ({ ...prev, tenantAddress: account || '' }))}
                disabled={!account}
              >
                Use my wallet as tenant
              </button>
            </div>
          </div>

          {/* Rent Amount */}
          <div className="form-group">
            <label htmlFor="rentAmount">Rent Amount (ETH) *</label>
            <input
              type="number"
              id="rentAmount"
              name="rentAmount"
              data-testid="input-rent-amount"
              value={formData.rentAmount}
              onChange={handleInputChange}
              placeholder="1.0"
              min="0.001"
              step="0.001"
              required
            />
            <small>Monthly rent amount in ETH</small>
          </div>

          {/* Payment method: ETH only (ERC20 support removed) */}

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
            </select>
            <small>Price feed contract used for conversion rates</small>
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
            <button 
              type="submit" 
              className="btn-primary" 
              data-testid="button-deploy-contract"
              disabled={loading}
            >
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
            {/* ERC20 approve/pay removed - payments use ETH only */}
          </div>
        </form>

        {createdContractAddress && (
          <div className="created-contract-info">
            <h4>Created Contract</h4>
            <p>Address: {createdContractAddress}</p>
            <button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(createdContractAddress); alert('Address copied to clipboard'); }}>
              Copy Address
            </button>
          </div>
        )}

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
