// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PropertyRegistry - minimal on-chain registry of rentable assets (non-transferable demo)
/// @notice In production you might instead use an ERC721 or ERC1155 token to represent ownership.
contract PropertyRegistry {
    struct Property {
        address owner;
        bytes32 locationHash; // hashed physical address / coordinates to avoid storing full PII
    string metadataURI;   // off-chain metadata (HTTPS or other secure store) with richer details & media
        bool active;
    }

    Property[] private _properties; // propertyId = index

    event PropertyRegistered(uint256 indexed propertyId, address indexed owner, bytes32 locationHash, string metadataURI);
    event PropertyDeactivated(uint256 indexed propertyId, address indexed by);
    event PropertyMetadataUpdated(uint256 indexed propertyId, string newURI);

    error NotOwner();
    error Inactive();
    error AlreadyInactive();
    error BadId();

    modifier onlyOwner(uint256 propertyId) {
        if (propertyId >= _properties.length) revert BadId();
        if (_properties[propertyId].owner != msg.sender) revert NotOwner();
        _;
    }

    function register(bytes32 locationHash, string calldata metadataURI) external returns (uint256 propertyId) {
        _properties.push(Property({ owner: msg.sender, locationHash: locationHash, metadataURI: metadataURI, active: true }));
        propertyId = _properties.length - 1;
        emit PropertyRegistered(propertyId, msg.sender, locationHash, metadataURI);
    }

    function deactivate(uint256 propertyId) external onlyOwner(propertyId) {
        Property storage p = _properties[propertyId];
        if (!p.active) revert AlreadyInactive();
        p.active = false;
        emit PropertyDeactivated(propertyId, msg.sender);
    }

    function updateMetadata(uint256 propertyId, string calldata newURI) external onlyOwner(propertyId) {
        Property storage p = _properties[propertyId];
        if (!p.active) revert Inactive();
        p.metadataURI = newURI;
        emit PropertyMetadataUpdated(propertyId, newURI);
    }

    function getProperty(uint256 propertyId) external view returns (address owner, bytes32 locationHash, string memory metadataURI, bool active) {
        if (propertyId >= _properties.length) revert BadId();
        Property storage p = _properties[propertyId];
        return (p.owner, p.locationHash, p.metadataURI, p.active);
    }

    function totalProperties() external view returns (uint256) { return _properties.length; }
}
