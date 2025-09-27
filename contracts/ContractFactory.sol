// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Rent/TemplateRentContract.sol";
import "./Rent/PropertyRegistry.sol";
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
        address _admin,
        address _arbitrationService
    ) external returns (address) {
        NDATemplate c = new NDATemplate(
            _partyA,
            _partyB,
            _expiryDate,
            _penaltyBps,
            _customClausesHash,
            _minDeposit,
            _admin,
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
    PropertyRegistry public immutable propertyRegistry; // optional registry (may be zero address if not used)

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
        propertyRegistry = new PropertyRegistry();
        factoryOwner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == factoryOwner, "Only owner");
        _;
    }

    /// @notice Set a factory-wide default arbitration service and required deposit that will be used when creating new Rent contracts.
    function setDefaultArbitrationService(address _service, uint256 _requiredDeposit) external onlyOwner {
        defaultArbitrationService = _service;
        defaultRequiredDeposit = _requiredDeposit;
    }

    function createRentContract(address _tenant, uint256 _rentAmount, address _priceFeed, uint256 _propertyId) external returns (address) {
        address creator = msg.sender;
    if (_tenant == address(0)) revert ZeroTenant();
    if (_tenant == creator) revert SameAddresses();
    if (_rentAmount == 0) revert ZeroRentAmount();
    if (_priceFeed == address(0)) revert ZeroPriceFeed();
    if (_priceFeed.code.length == 0) revert PriceFeedNotContract();
    // Validate property if provided
    if (_propertyId != 0) {
        (address owner,, , bool active) = propertyRegistry.getProperty(_propertyId);
        require(active && owner == creator, "Bad property");
    }
    // pass 0 as default dueDate for backward compatibility; no initial evidence URI
    address newAddr = rentDeployer.deploy(creator, _tenant, _rentAmount, 0, _priceFeed, _propertyId, defaultArbitrationService, defaultRequiredDeposit, "");
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit RentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    /// @notice Create a Rent contract and provide an explicit dueDate (unix timestamp).
    /// This overload preserves backwards compatibility while allowing callers (e.g., frontend)
    /// to compute and set the contract's `dueDate` at creation time.
    function createRentContract(address _tenant, uint256 _rentAmount, address _priceFeed, uint256 _dueDate, uint256 _propertyId) external returns (address) {
        address creator = msg.sender;
        if (_tenant == address(0)) revert ZeroTenant();
        if (_tenant == creator) revert SameAddresses();
        if (_rentAmount == 0) revert ZeroRentAmount();
        if (_priceFeed == address(0)) revert ZeroPriceFeed();
        if (_priceFeed.code.length == 0) revert PriceFeedNotContract();
        // Validate property if provided
        if (_propertyId != 0) {
            (address owner,, , bool active) = propertyRegistry.getProperty(_propertyId);
            require(active && owner == creator, "Bad property");
        }
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
        // Validate property if provided
        if (_propertyId != 0) {
            (address owner,, , bool active) = propertyRegistry.getProperty(_propertyId);
            require(active && owner == creator, "Bad property");
        }
    address newAddr = rentDeployer.deploy(creator, _tenant, _rentAmount, _dueDate, _priceFeed, _propertyId, defaultArbitrationService, defaultRequiredDeposit, _initialEvidenceUri);
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit RentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    /// @notice Register a property and return propertyId (helper passthrough)
    function registerProperty(bytes32 locationHash, string calldata metadataURI) external returns (uint256) {
        return propertyRegistry.register(locationHash, metadataURI);
    }

    function createNDA(
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit
    ) external returns (address) {
        // Backwards-compatible overload: validate arbitrator when provided then deploy
        address creator = msg.sender;
        if (_partyB == address(0)) revert ZeroPartyB();
        if (_partyB == creator) revert SameParties();
        if (!(_expiryDate > block.timestamp)) revert ExpiryNotFuture();
        if (!(_penaltyBps <= 10000)) revert PenaltyTooHigh();
        if (_minDeposit == 0) revert MinDepositZero();
        address newAddr = ndaDeployer.deploy(
            creator,
            _partyB,
            _expiryDate,
            _penaltyBps,
            _customClausesHash,
            _minDeposit,
            creator, // admin = creator
            defaultArbitrationService
        );
        allContracts.push(newAddr);
        contractsByCreator[creator].push(newAddr);
        contractCreator[newAddr] = creator;
        emit NDACreated(newAddr, creator, _partyB);
        return newAddr;
    }

    // The factory exposes `createNDA(..., address _arbitrator, uint256 _minDeposit)`
    // as the public API to remain compatible with earlier tests and callers.

    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    // Convenience: total counts to avoid returning large arrays in one call
    function getAllContractsCount() external view returns (uint256) {
        return allContracts.length;
    }

    /// @notice Return a page of `contractsByCreator[creator]` starting at `start`, up to `count` entries
    function getContractsByCreatorPaged(address creator, uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 total = contractsByCreator[creator].length;
        if (start >= total) {
            return new address[](0);
        }
        uint256 end = start + count;
        if (end > total) {
            end = total;
        }
        uint256 size = end - start;
        address[] memory page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = contractsByCreator[creator][start + i];
        }
        return page;
    }

    /// @notice Return a page of `allContracts` starting at `start`, up to `count` entries
    function getAllContractsPaged(uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 total = allContracts.length;
        if (start >= total) {
            return new address[](0);
        }
        uint256 end = start + count;
        if (end > total) {
            end = total;
        }
        uint256 size = end - start;
        address[] memory page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = allContracts[start + i];
        }
        return page;
    }

    function getContractsByCreator(address creator) external view returns (address[] memory) {
        return contractsByCreator[creator];
    }

    /// @notice Return the creator/deployer of a specific contract (zero address if unknown)
    function getCreatorOf(address contractAddr) external view returns (address) {
        return contractCreator[contractAddr];
    }
}