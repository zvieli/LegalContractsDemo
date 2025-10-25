import React, { useState, useEffect, useCallback } from 'react';
import './KeyManagement.css';

const KeyManagement = ({ 
  walletAddress, 
  provider: _provider, 
  keyRegistryContract, 
  onKeyUpdate 
}) => {
  // _provider prop intentionally unused in this component; mark as referenced for ESLint
  void _provider;
  const [keys, setKeys] = useState([]);
  const [_activeKeyId, _setActiveKeyId] = useState(null);
  const [newKeyData, setNewKeyData] = useState({
    publicKey: '',
    lifetime: '',
    metadata: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Load user's keys on component mount
  useEffect(() => {
    if (keyRegistryContract && walletAddress) {
      loadUserKeys();
    }
  }, [keyRegistryContract, walletAddress, loadUserKeys]);
  
  const loadUserKeys = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get active key info
    const [_activePublicKey, activeId, isValid] = await keyRegistryContract.getActiveKey(walletAddress);
  _setActiveKeyId(isValid ? Number(activeId) : null);
      
      // Get all keys (paginated)
      const [keyIds, publicKeys, validFroms, validUntils, revokeds, metadatas] = 
        await keyRegistryContract.getKeys(walletAddress, 0, 50);
      
      const keyList = keyIds.map((id, index) => ({
        id: Number(id),
        publicKey: publicKeys[index],
        validFrom: new Date(Number(validFroms[index]) * 1000),
        validUntil: Number(validUntils[index]) === 0 ? null : new Date(Number(validUntils[index]) * 1000),
        revoked: revokeds[index],
        metadata: metadatas[index],
        isActive: Number(activeId) === Number(id) && isValid
      }));
      
      setKeys(keyList);
    } catch (err) {
      console.error('Error loading keys:', err);
      setError('Failed to load keys: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  }, [keyRegistryContract, walletAddress]);
  
  const generateKeyPair = async () => {
    try {
      // Generate ECIES key pair using Web Crypto API
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "ECDH",
          namedCurve: "P-256"
        },
        true,
        ["deriveKey"]
      );
      
      // Export public key
      const publicKeyBuffer = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
      const publicKeyHex = Array.from(new Uint8Array(publicKeyBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Remove the 0x04 prefix if present (registry expects 64 bytes without prefix)
      const cleanPublicKey = publicKeyHex.startsWith('04') ? publicKeyHex.slice(2) : publicKeyHex;
      
      setNewKeyData(prev => ({
        ...prev,
        publicKey: '0x' + cleanPublicKey
      }));
      
      setSuccess('Key pair generated! Make sure to save your private key securely.');
    } catch (err) {
      console.error('Error generating key pair:', err);
      setError('Failed to generate key pair: ' + (err.message || err));
    }
  };
  
  const registerKey = async () => {
    try {
      if (!newKeyData.publicKey || newKeyData.publicKey.length !== 130) { // 0x + 128 hex chars = 64 bytes
        throw new Error('Invalid public key format. Expected 64 bytes (128 hex chars + 0x prefix)');
      }
      
      setLoading(true);
      setError('');
      
      const lifetime = newKeyData.lifetime ? parseInt(newKeyData.lifetime) * 24 * 60 * 60 : 0; // Convert days to seconds
      
      const tx = await keyRegistryContract.registerKey(
        newKeyData.publicKey,
        lifetime,
        newKeyData.metadata || ''
      );
      
      await tx.wait();
      
      setSuccess('Key registered successfully!');
      setNewKeyData({ publicKey: '', lifetime: '', metadata: '' });
      
      // Reload keys
      await loadUserKeys();
      
      // Notify parent component
      if (onKeyUpdate) {
        onKeyUpdate();
      }
    } catch (err) {
      console.error('Error registering key:', err);
      setError('Failed to register key: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };
  
  const setActiveKey = async (keyId) => {
    try {
      setLoading(true);
      setError('');
      
      const tx = await keyRegistryContract.setActiveKey(keyId);
      await tx.wait();
      
      setSuccess(`Key ${keyId} set as active!`);
      await loadUserKeys();
      
      if (onKeyUpdate) {
        onKeyUpdate();
      }
    } catch (err) {
      console.error('Error setting active key:', err);
      setError('Failed to set active key: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };
  
  const revokeKey = async (keyId, reason) => {
    try {
      if (!reason) {
        reason = prompt('Please provide a reason for revoking this key:');
        if (!reason) return;
      }
      
      setLoading(true);
      setError('');
      
      const tx = await keyRegistryContract.revokeKey(keyId, reason);
      await tx.wait();
      
      setSuccess(`Key ${keyId} revoked successfully!`);
      await loadUserKeys();
      
      if (onKeyUpdate) {
        onKeyUpdate();
      }
    } catch (err) {
      console.error('Error revoking key:', err);
      setError('Failed to revoke key: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };
  
  const formatDate = (date) => {
    if (!date) return 'Never';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };
  
  const isKeyExpired = (key) => {
    return key.validUntil && new Date() > key.validUntil;
  };
  
  const isKeyValid = (key) => {
    return !key.revoked && !isKeyExpired(key) && new Date() >= key.validFrom;
  };

  return (
    <div className="key-management">
      <h3>🔐 Encryption Key Management</h3>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      
      {/* Key Registration Form */}
      <div className="key-registration">
        <h4>Register New Key</h4>
        <div className="form-group">
          <label>Public Key (ECIES):</label>
          <input
            type="text"
            value={newKeyData.publicKey}
            onChange={(e) => setNewKeyData(prev => ({ ...prev, publicKey: e.target.value }))}
            placeholder="0x..."
            className="key-input"
          />
          <button onClick={generateKeyPair} className="generate-key-btn">
            🎲 Generate Key Pair
          </button>
        </div>
        
        <div className="form-group">
          <label>Lifetime (days, 0 = default):</label>
          <input
            type="number"
            value={newKeyData.lifetime}
            onChange={(e) => setNewKeyData(prev => ({ ...prev, lifetime: e.target.value }))}
            placeholder="365"
            min="0"
          />
        </div>
        
        <div className="form-group">
          <label>Metadata (optional):</label>
          <input
            type="text"
            value={newKeyData.metadata}
            onChange={(e) => setNewKeyData(prev => ({ ...prev, metadata: e.target.value }))}
            placeholder="Primary landlord key"
          />
        </div>
        
        <button 
          onClick={registerKey} 
          disabled={loading || !newKeyData.publicKey}
          className="register-key-btn"
        >
          {loading ? '⏳ Registering...' : '📝 Register Key'}
        </button>
      </div>
      
      {/* Keys List */}
      <div className="keys-list">
        <h4>Your Registered Keys</h4>
        {loading && <div>Loading keys...</div>}
        
        {keys.length === 0 && !loading && (
          <div className="no-keys">No keys registered yet.</div>
        )}
        
        {keys.map((key) => (
          <div key={key.id} className={`key-item ${key.isActive ? 'active' : ''}`}>
            <div className="key-header">
              <span className="key-id">Key #{key.id}</span>
              {key.isActive && <span className="active-badge">🟢 ACTIVE</span>}
              {key.revoked && <span className="revoked-badge">🔴 REVOKED</span>}
              {isKeyExpired(key) && <span className="expired-badge">⏰ EXPIRED</span>}
              {!isKeyValid(key) && !key.revoked && !isKeyExpired(key) && <span className="invalid-badge">⚠️ INVALID</span>}
            </div>
            
            <div className="key-details">
              <div className="key-field">
                <strong>Public Key:</strong> 
                <code className="key-value">{key.publicKey.slice(0, 20)}...{key.publicKey.slice(-20)}</code>
              </div>
              
              {key.metadata && (
                <div className="key-field">
                  <strong>Metadata:</strong> {key.metadata}
                </div>
              )}
              
              <div className="key-field">
                <strong>Valid From:</strong> {formatDate(key.validFrom)}
              </div>
              
              <div className="key-field">
                <strong>Valid Until:</strong> {formatDate(key.validUntil)}
              </div>
            </div>
            
            <div className="key-actions">
              {!key.isActive && isKeyValid(key) && (
                <button 
                  onClick={() => setActiveKey(key.id)}
                  className="set-active-btn"
                  disabled={loading}
                >
                  ✅ Set Active
                </button>
              )}
              
              {!key.revoked && (
                <button 
                  onClick={() => revokeKey(key.id)}
                  className="revoke-btn"
                  disabled={loading}
                >
                  🚫 Revoke
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Key Management Tips */}
      <div className="key-tips">
        <h4>💡 Key Management Tips</h4>
        <ul>
          <li><strong>🔐 Security:</strong> Always generate keys in a secure environment and store private keys safely</li>
          <li><strong>🔄 Rotation:</strong> Regularly rotate your keys for better security</li>
          <li><strong>⏰ Expiration:</strong> Set appropriate lifetimes for your keys</li>
          <li><strong>🚫 Revocation:</strong> Immediately revoke compromised keys</li>
          <li><strong>💾 Backup:</strong> Keep secure backups of your private keys</li>
        </ul>
      </div>
    </div>
  );
};

export default KeyManagement;