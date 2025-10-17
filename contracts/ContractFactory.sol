// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Rent/EnhancedRentContract.sol";
import "./NDA/NDATemplate.sol";

// Enhanced rent deployer with Merkle evidence support
contract _EnhancedRentDeployer {
    function deploy(
        address _landlord, 
        address _tenant, 
        uint256 _rentAmount, 
        address _priceFeed, 
        uint256 _dueDate, 
        uint256 _propertyId, 
        address _arbitrationService,
        address _merkleEvidenceManager
    ) external returns (address) {
        EnhancedRentContract c = new EnhancedRentContract(
            _landlord,
            _tenant,
            _rentAmount,
            _priceFeed,
            _dueDate,
            _propertyId,
            _arbitrationService,
            _merkleEvidenceManager
        );
        return address(c);
    }
}

// Lightweight deployer for NDA contracts
contract _NDADeployer {
    function deploy(
        address _partyA,
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit,
        address _arbitrationService,
        address _merkleEvidenceManager,
        PayFeesIn _payFeesIn
    ) external returns (address) {
        NDATemplate c = new NDATemplate(
            _partyA,
            _partyB,
            _arbitrationService,
            address(this),
            _expiryDate,
            _penaltyBps,
            _customClausesHash,
            _minDeposit,
            _merkleEvidenceManager,
            _payFeesIn
        );
        return address(c);
    }
}

contract ContractFactory {
    address public factoryOwner;
    address public defaultArbitrationService;
    address public merkleEvidenceManager;
    address[] public allContracts;
    mapping(address => address[]) public contractsByCreator;
    mapping(address => address) public contractCreator;

    _EnhancedRentDeployer private immutable enhancedRentDeployer;
    _NDADeployer private immutable ndaDeployer;

    // Custom errors
    error ZeroTenant();
    error SameAddresses();
    error ZeroRentAmount();
    error ZeroPriceFeed();
    error PriceFeedNotContract();
    error ZeroPartyB();
    error SameParties();
    error ExpiryNotFuture();
    error PenaltyTooHigh();
    error MinDepositZero();
    error ArbitratorNotContract();

    event EnhancedRentContractCreated(address indexed contractAddress, address indexed landlord, address indexed tenant);
    event NDACreated(address indexed contractAddress, address indexed partyA, address indexed partyB);

    constructor() {
        enhancedRentDeployer = new _EnhancedRentDeployer();
        ndaDeployer = new _NDADeployer();
        factoryOwner = msg.sender;
    }


    modifier onlyOwner() {
        require(msg.sender == factoryOwner, "Only owner");
        _;
    }


    function setDefaultArbitrationService(address _arbitrationService) external onlyOwner {
        require(_arbitrationService != address(0), "Zero address arbitration service");
        defaultArbitrationService = _arbitrationService;
    }

    function setMerkleEvidenceManager(address _merkleEvidenceManager) external onlyOwner {
        require(_merkleEvidenceManager != address(0), "Zero address not allowed");
        merkleEvidenceManager = _merkleEvidenceManager;
    }

    /// @notice Create enhanced rent contract with Merkle evidence support
    function createEnhancedRentContract(
        address _tenant, 
        uint256 _rentAmount, 
        address _priceFeed, 
        uint256 _dueDate, 
        uint256 _propertyId
    ) external returns (address) {
        require(merkleEvidenceManager != address(0), "Merkle evidence manager not set");
        
        address creator = msg.sender;
        if (_tenant == address(0)) revert ZeroTenant();
        if (_tenant == creator) revert SameAddresses();
        if (_rentAmount == 0) revert ZeroRentAmount();
        if (_priceFeed == address(0)) revert ZeroPriceFeed();
        if (_priceFeed.code.length == 0) revert PriceFeedNotContract();
        
        address newAddr = enhancedRentDeployer.deploy(
            creator, 
            _tenant, 
            _rentAmount, 
            _priceFeed, 
            _dueDate, 
            _propertyId, 
            defaultArbitrationService,
            merkleEvidenceManager
        );
        
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit EnhancedRentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    function createNDA(
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit,
        PayFeesIn _payFeesIn
    ) external returns (address) {
        address creator = msg.sender;
        if (_partyB == address(0)) revert ZeroPartyB();
        if (_partyB == creator) revert SameParties();
        if (_expiryDate <= block.timestamp) revert ExpiryNotFuture();
        if (_penaltyBps > 10000) revert PenaltyTooHigh();
        if (_minDeposit == 0) revert MinDepositZero();
        require(merkleEvidenceManager != address(0), "Merkle evidence manager not set");

        address newAddr = ndaDeployer.deploy(
            creator,
            _partyB,
            _expiryDate,
            _penaltyBps,
            _customClausesHash,
            _minDeposit,
            defaultArbitrationService,
            merkleEvidenceManager,
            _payFeesIn
        );
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit NDACreated(newAddr, creator, _partyB);
        return newAddr;
    }

    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    function getContractsByCreator(address _creator) external view returns (address[] memory) {
        return contractsByCreator[_creator];
    }

    function getContractCreator(address _contractAddr) external view returns (address) {
        return contractCreator[_contractAddr];
    }

    function getTotalContractsCount() external view returns (uint256) {
        return allContracts.length;
    }
}
