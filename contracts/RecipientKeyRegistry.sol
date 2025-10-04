// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title RecipientKeyRegistry
/// @notice On-chain registry for ECIES public keys with revocation support
/// @dev Enables secure key distribution and rotation for evidence encryption
contract RecipientKeyRegistry is Ownable {
    struct KeyInfo {
        bytes publicKey;        // ECIES public key (uncompressed, without 0x04 prefix)
        uint256 validFrom;      // Timestamp when key became valid
        uint256 validUntil;     // Timestamp when key expires (0 = never)
        bool revoked;           // Emergency revocation flag
        string metadata;        // Optional metadata (key purpose, contact info, etc.)
    }
    
    // address => keyId => KeyInfo
    mapping(address => mapping(uint256 => KeyInfo)) public keys;
    
    // address => current active key ID
    mapping(address => uint256) public activeKeyId;
    
    // address => total keys registered
    mapping(address => uint256) public keyCount;
    
    // Global key rotation policies
    uint256 public defaultKeyLifetime = 365 days;  // Default key validity period
    uint256 public minKeyLifetime = 7 days;        // Minimum allowed key lifetime
    uint256 public maxKeyLifetime = 1095 days;     // Maximum allowed key lifetime (3 years)
    
    event KeyRegistered(
        address indexed account, 
        uint256 indexed keyId, 
        bytes publicKey, 
        uint256 validFrom, 
        uint256 validUntil
    );
    
    event KeyRevoked(address indexed account, uint256 indexed keyId, string reason);
    event ActiveKeyChanged(address indexed account, uint256 oldKeyId, uint256 newKeyId);
    event KeyRotationRequested(address indexed account, uint256 currentKeyId, uint256 newKeyId);
    
    error InvalidPublicKey();
    error KeyLifetimeOutOfRange();
    error KeyNotFound();
    error KeyAlreadyRevoked();
    error KeyExpiredError();
    error NotKeyOwner();
    error NoActiveKey();

    constructor() Ownable(msg.sender) {}

    /// @notice Register a new ECIES public key for an account
    /// @param publicKey The ECIES public key (64 bytes, uncompressed without 0x04 prefix)
    /// @param lifetime Key validity period in seconds (0 = use default)
    /// @param metadata Optional metadata string
    function registerKey(
        bytes calldata publicKey, 
        uint256 lifetime, 
        string calldata metadata
    ) external returns (uint256 keyId) {
        if (publicKey.length != 64) revert InvalidPublicKey();
        
        uint256 validLifetime = lifetime == 0 ? defaultKeyLifetime : lifetime;
        if (validLifetime < minKeyLifetime || validLifetime > maxKeyLifetime) {
            revert KeyLifetimeOutOfRange();
        }
        
        keyId = keyCount[msg.sender];
        keyCount[msg.sender] = keyId + 1;
        
        uint256 validFrom = block.timestamp;
        uint256 validUntil = validFrom + validLifetime;
        
        keys[msg.sender][keyId] = KeyInfo({
            publicKey: publicKey,
            validFrom: validFrom,
            validUntil: validUntil,
            revoked: false,
            metadata: metadata
        });
        
        // If this is the first key, make it active
        if (keyId == 0) {
            activeKeyId[msg.sender] = keyId;
            emit ActiveKeyChanged(msg.sender, type(uint256).max, keyId);
        }
        
        emit KeyRegistered(msg.sender, keyId, publicKey, validFrom, validUntil);
        return keyId;
    }
    
    /// @notice Set the active key for the caller
    /// @param keyId The key ID to activate
    function setActiveKey(uint256 keyId) external {
        if (keyId >= keyCount[msg.sender]) revert KeyNotFound();
        
        KeyInfo storage key = keys[msg.sender][keyId];
        if (key.revoked) revert KeyAlreadyRevoked();
        if (block.timestamp >= key.validUntil && key.validUntil != 0) revert KeyExpiredError();
        
        uint256 oldKeyId = activeKeyId[msg.sender];
        activeKeyId[msg.sender] = keyId;
        
        emit ActiveKeyChanged(msg.sender, oldKeyId, keyId);
    }
    
    /// @notice Revoke a key (emergency use)
    /// @param keyId The key ID to revoke
    /// @param reason Human-readable reason for revocation
    function revokeKey(uint256 keyId, string calldata reason) external {
        if (keyId >= keyCount[msg.sender]) revert KeyNotFound();
        
        KeyInfo storage key = keys[msg.sender][keyId];
        if (key.revoked) revert KeyAlreadyRevoked();
        
        key.revoked = true;
        
        // If this was the active key, clear active status
        if (activeKeyId[msg.sender] == keyId) {
            // Try to find next valid key
            bool foundReplacement = false;
            for (uint256 i = keyCount[msg.sender]; i > 0; i--) {
                uint256 candidateId = i - 1;
                if (candidateId == keyId) continue;
                
                KeyInfo storage candidate = keys[msg.sender][candidateId];
                if (!candidate.revoked && 
                    block.timestamp >= candidate.validFrom && 
                    (candidate.validUntil == 0 || block.timestamp < candidate.validUntil)) {
                    activeKeyId[msg.sender] = candidateId;
                    emit ActiveKeyChanged(msg.sender, keyId, candidateId);
                    foundReplacement = true;
                    break;
                }
            }
            if (!foundReplacement) {
                // No valid keys remain - emit with max value to indicate no active key
                emit ActiveKeyChanged(msg.sender, keyId, type(uint256).max);
            }
        }
        
        emit KeyRevoked(msg.sender, keyId, reason);
    }
    
    /// @notice Get the currently active public key for an account
    /// @param account The account to query
    /// @return publicKey The active public key (empty if none active)
    /// @return keyId The active key ID
    /// @return isValid Whether the key is currently valid
    function getActiveKey(address account) 
        external 
        view 
        returns (bytes memory publicKey, uint256 keyId, bool isValid) 
    {
        if (keyCount[account] == 0) {
            return ("", type(uint256).max, false);
        }
        
        keyId = activeKeyId[account];
        if (keyId >= keyCount[account]) {
            return ("", type(uint256).max, false);
        }
        
        KeyInfo storage key = keys[account][keyId];
        isValid = !key.revoked && 
                 block.timestamp >= key.validFrom && 
                 (key.validUntil == 0 || block.timestamp < key.validUntil);
        
        return (key.publicKey, keyId, isValid);
    }
    
    /// @notice Get all keys for an account (paginated)
    /// @param account The account to query
    /// @param offset Starting key ID
    /// @param limit Maximum number of keys to return
    function getKeys(address account, uint256 offset, uint256 limit) 
        external 
        view 
        returns (
            uint256[] memory keyIds,
            bytes[] memory publicKeys,
            uint256[] memory validFroms,
            uint256[] memory validUntils,
            bool[] memory revokeds,
            string[] memory metadatas
        ) 
    {
        uint256 total = keyCount[account];
        if (offset >= total) {
            // Return empty arrays
            return (new uint256[](0), new bytes[](0), new uint256[](0), 
                   new uint256[](0), new bool[](0), new string[](0));
        }
        
        uint256 remaining = total - offset;
        uint256 length = remaining > limit ? limit : remaining;
        
        keyIds = new uint256[](length);
        publicKeys = new bytes[](length);
        validFroms = new uint256[](length);
        validUntils = new uint256[](length);
        revokeds = new bool[](length);
        metadatas = new string[](length);
        
        for (uint256 i = 0; i < length; i++) {
            uint256 keyId = offset + i;
            KeyInfo storage key = keys[account][keyId];
            
            keyIds[i] = keyId;
            publicKeys[i] = key.publicKey;
            validFroms[i] = key.validFrom;
            validUntils[i] = key.validUntil;
            revokeds[i] = key.revoked;
            metadatas[i] = key.metadata;
        }
    }
    
    /// @notice Check if a specific key is currently valid
    /// @param account The account to check
    /// @param keyId The key ID to check
    function isKeyValid(address account, uint256 keyId) external view returns (bool) {
        if (keyId >= keyCount[account]) return false;
        
        KeyInfo storage key = keys[account][keyId];
        return !key.revoked && 
               block.timestamp >= key.validFrom && 
               (key.validUntil == 0 || block.timestamp < key.validUntil);
    }
    
    /// @notice Batch query for active keys of multiple accounts
    /// @param accounts Array of accounts to query
    function batchGetActiveKeys(address[] calldata accounts) 
        external 
        view 
        returns (
            bytes[] memory publicKeys,
            uint256[] memory keyIds,
            bool[] memory isValids
        )
    {
        uint256 length = accounts.length;
        publicKeys = new bytes[](length);
        keyIds = new uint256[](length);
        isValids = new bool[](length);
        
        for (uint256 i = 0; i < length; i++) {
            (publicKeys[i], keyIds[i], isValids[i]) = this.getActiveKey(accounts[i]);
        }
    }
    
    /// @notice Emergency function to revoke a key (owner only)
    /// @param account The account whose key to revoke
    /// @param keyId The key ID to revoke
    /// @param reason Reason for emergency revocation
    function emergencyRevokeKey(address account, uint256 keyId, string calldata reason) external onlyOwner {
        if (keyId >= keyCount[account]) revert KeyNotFound();
        
        KeyInfo storage key = keys[account][keyId];
        if (key.revoked) revert KeyAlreadyRevoked();
        
        key.revoked = true;
        emit KeyRevoked(account, keyId, reason);
    }
    
    /// @notice Update key lifetime policies (owner only)
    function updateKeyLifetimePolicies(
        uint256 newDefaultLifetime,
        uint256 newMinLifetime, 
        uint256 newMaxLifetime
    ) external onlyOwner {
        require(newMinLifetime <= newDefaultLifetime && newDefaultLifetime <= newMaxLifetime, "Invalid lifetime range");
        
        defaultKeyLifetime = newDefaultLifetime;
        minKeyLifetime = newMinLifetime;
        maxKeyLifetime = newMaxLifetime;
    }
}