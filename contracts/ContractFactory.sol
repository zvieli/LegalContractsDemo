// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Rent/TemplateRentContract.sol";
import "./NDA/NDATemplate.sol";

// Lightweight deployer for Rent contracts (keeps large creation bytecode out of main factory runtime)
contract _RentDeployer {
    function deploy(address _landlord, address _tenant, uint256 _rentAmount, uint256 _dueDate, address _priceFeed, uint256 _propertyId, address _arbitration_service, uint256 _requiredDeposit, string memory _initialEvidenceUri) external returns (address) {
        TemplateRentContract c = new TemplateRentContract(_landlord, _tenant, _rentAmount, _dueDate, _priceFeed, _propertyId, _arbitration_service, _requiredDeposit, _initialEvidenceUri);
        return address(c);
    }
}

// Lightweight deployer for NDA contracts (now passes explicit admin)
contract _NDADeployer {
    function deploy(
        address _partyA,
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit,
        address _arbitrationService
    ) external returns (address) {
        NDATemplate c = new NDATemplate(
            _partyA,
            _partyB,
            _expiryDate,
            _penaltyBps,
            _customClausesHash,
            _minDeposit,
            _arbitrationService
        );
        return address(c);
    }
}

contract ContractFactory {
    address public factoryOwner;
    address public defaultArbitrationService;
    uint256 public defaultRequiredDeposit;
    address[] public allContracts;
    mapping(address => address[]) public contractsByCreator;
    // Map a contract address to its creator (deployer) for quick lookup
    mapping(address => address) public contractCreator;
    _RentDeployer private immutable rentDeployer;
    _NDADeployer private immutable ndaDeployer;

    // Custom errors (gas-cheaper than revert strings)
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

    event RentContractCreated(address indexed contractAddress, address indexed landlord, address indexed tenant);
    event NDACreated(address indexed contractAddress, address indexed partyA, address indexed partyB);

    constructor() {
        rentDeployer = new _RentDeployer();
        ndaDeployer = new _NDADeployer();
        factoryOwner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == factoryOwner, "Only owner");
        _;
    }

    function setDefaultArbitrationService(address _arbitrationService, uint256 _requiredDeposit) external onlyOwner {
        require(_arbitrationService != address(0), "Zero address arbitration service");
        defaultArbitrationService = _arbitrationService;
        defaultRequiredDeposit = _requiredDeposit;
    }

    function createRentContract(address _tenant, uint256 _rentAmount, address _priceFeed, uint256 _propertyId) external returns (address) {
        address creator = msg.sender;
        if (_tenant == address(0)) revert ZeroTenant();
        if (_tenant == creator) revert SameAddresses();
        if (_rentAmount == 0) revert ZeroRentAmount();
        if (_priceFeed == address(0)) revert ZeroPriceFeed();
        if (_priceFeed.code.length == 0) revert PriceFeedNotContract();
        // Property validation removed - V7 simplification
        // pass 0 as default dueDate for backward compatibility; no initial evidence URI
        address newAddr = rentDeployer.deploy(creator, _tenant, _rentAmount, 0, _priceFeed, _propertyId, defaultArbitrationService, defaultRequiredDeposit, "");
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit RentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    function createRentContract(address _tenant, uint256 _rentAmount, address _priceFeed, uint256 _dueDate, uint256 _propertyId) external returns (address) {
        address creator = msg.sender;
        if (_tenant == address(0)) revert ZeroTenant();
        if (_tenant == creator) revert SameAddresses();
        if (_rentAmount == 0) revert ZeroRentAmount();
        if (_priceFeed == address(0)) revert ZeroPriceFeed();
        if (_priceFeed.code.length == 0) revert PriceFeedNotContract();
        // Property validation removed - V7 simplification
        address newAddr = rentDeployer.deploy(creator, _tenant, _rentAmount, _dueDate, _priceFeed, _propertyId, defaultArbitrationService, defaultRequiredDeposit, "");
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit RentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    /// @notice Create a Rent contract with an explicit dueDate and an initial evidence URI (string)
    function createRentContract(address _tenant, uint256 _rentAmount, address _priceFeed, uint256 _dueDate, uint256 _propertyId, string calldata _initialEvidenceUri) external returns (address) {
        address creator = msg.sender;
        if (_tenant == address(0)) revert ZeroTenant();
        if (_tenant == creator) revert SameAddresses();
        if (_rentAmount == 0) revert ZeroRentAmount();
        if (_priceFeed == address(0)) revert ZeroPriceFeed();
        if (_priceFeed.code.length == 0) revert PriceFeedNotContract();
        // Property validation removed - V7 simplification
        address newAddr = rentDeployer.deploy(creator, _tenant, _rentAmount, _dueDate, _priceFeed, _propertyId, defaultArbitrationService, defaultRequiredDeposit, _initialEvidenceUri);
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit RentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    // Property registration removed in V7 - contracts work with propertyId as simple uint256

    function createNDA(
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit
    ) external returns (address) {
        address creator = msg.sender;
        if (_partyB == address(0)) revert ZeroPartyB();
        if (_partyB == creator) revert SameParties();
        if (_expiryDate <= block.timestamp) revert ExpiryNotFuture();
        if (_penaltyBps > 10000) revert PenaltyTooHigh();
        if (_minDeposit == 0) revert MinDepositZero();

        // Factory sets itself as admin for the NDA template
    address newAddr = ndaDeployer.deploy(creator, _partyB, _expiryDate, _penaltyBps, _customClausesHash, _minDeposit, defaultArbitrationService);
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