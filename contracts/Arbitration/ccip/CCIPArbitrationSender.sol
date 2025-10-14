// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {CCIPArbitrationTypes} from "./CCIPArbitrationTypes.sol";

/**
 * @title CCIPArbitrationSender
 * @notice Sends arbitration requests via CCIP to Oracle network
 * @dev Based on Chainlink CCIP BasicMessageSender pattern
 */
contract CCIPArbitrationSender {
    
    enum PayFeesIn {
        Native,
        LINK
    }

    // Core CCIP components
    IRouterClient private immutable i_router;
    LinkTokenInterface private immutable i_linkToken;
    
    // Oracle configuration
    uint64 public oracleChainSelector;
    address public oracleReceiver;
    
    // Access control
    address public owner;
    mapping(address => bool) public authorizedContracts;
    
    // Request tracking
    mapping(bytes32 => CCIPArbitrationTypes.ArbitrationRequest) public pendingRequests;
    mapping(bytes32 => bool) public processedRequests;
    
    // Events
    event ArbitrationRequestSent(
        bytes32 indexed messageId,
        bytes32 indexed disputeId,
        address indexed contractAddress,
        uint256 caseId
    );
    
    event OracleConfigUpdated(
        uint64 chainSelector,
        address receiver
    );
    
    event ContractAuthorized(address indexed contractAddr, bool authorized);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    modifier onlyAuthorizedContract() {
        require(authorizedContracts[msg.sender], "Contract not authorized");
        _;
    }

    /**
     * @notice Constructor
     * @param router CCIP Router address
     * @param linkToken LINK token address
     * @param _oracleChainSelector Chain selector for oracle network
     * @param _oracleReceiver Oracle receiver contract address
     */
    constructor(
        address router,
        address linkToken,
        uint64 _oracleChainSelector,
        address _oracleReceiver
    ) {
        require(router != address(0), "Invalid router");
        require(linkToken != address(0), "Invalid LINK token");
        require(_oracleReceiver != address(0), "Invalid oracle receiver");
        
        i_router = IRouterClient(router);
        i_linkToken = LinkTokenInterface(linkToken);
        oracleChainSelector = _oracleChainSelector;
        oracleReceiver = _oracleReceiver;
        owner = msg.sender;
    }

    /**
     * @notice Send arbitration request via CCIP
     * @param disputeId Unique dispute identifier
     * @param contractAddress Contract with the dispute
     * @param caseId Case ID within the contract
     * @param evidenceHash Hash of evidence
     * @param evidenceURI URI to evidence data
     * @param requestedAmount Amount being disputed
     * @param payFeesIn How to pay CCIP fees (Native or LINK)
     */
    function sendArbitrationRequest(
        bytes32 disputeId,
        address contractAddress,
        uint256 caseId,
        bytes32 evidenceHash,
        string calldata evidenceURI,
        uint256 requestedAmount,
        PayFeesIn payFeesIn
    ) external payable onlyAuthorizedContract returns (bytes32 messageId) {
        
        // Create arbitration request
        CCIPArbitrationTypes.ArbitrationRequest memory request = 
            CCIPArbitrationTypes.ArbitrationRequest({
                disputeId: disputeId,
                contractAddress: contractAddress,
                caseId: caseId,
                requester: msg.sender,
                evidenceHash: evidenceHash,
                evidenceURI: evidenceURI,
                requestedAmount: requestedAmount,
                timestamp: block.timestamp
            });

        // Encode request as CCIP message
        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = 
            CCIPArbitrationTypes.CCIPMessage({
                messageType: CCIPArbitrationTypes.MessageType.REQUEST,
                data: abi.encode(request)
            });

        // Create CCIP message
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(oracleReceiver),
            data: abi.encode(ccipMsg),
            tokenAmounts: new Client.EVMTokenAmount[](0), // No token transfer
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: 300_000}) // Gas for oracle processing
            ),
            feeToken: payFeesIn == PayFeesIn.LINK ? address(i_linkToken) : address(0)
        });

        // Calculate fees
        uint256 fees = i_router.getFee(oracleChainSelector, message);
        
        // Pay fees
        if (payFeesIn == PayFeesIn.LINK) {
            i_linkToken.transferFrom(msg.sender, address(this), fees);
            i_linkToken.approve(address(i_router), fees);
        } else {
            require(msg.value >= fees, "Insufficient native for fees");
        }

        // Send message
        messageId = i_router.ccipSend{value: payFeesIn == PayFeesIn.Native ? fees : 0}(
            oracleChainSelector,
            message
        );

        // Store request
        pendingRequests[messageId] = request;

        emit ArbitrationRequestSent(messageId, disputeId, contractAddress, caseId);
        
        return messageId;
    }

    /**
     * @notice Update oracle configuration
     * @param _oracleChainSelector New oracle chain selector
     * @param _oracleReceiver New oracle receiver address
     */
    function updateOracleConfig(
        uint64 _oracleChainSelector,
        address _oracleReceiver
    ) external onlyOwner {
        require(_oracleReceiver != address(0), "Invalid oracle receiver");
        
        oracleChainSelector = _oracleChainSelector;
        oracleReceiver = _oracleReceiver;
        
        emit OracleConfigUpdated(_oracleChainSelector, _oracleReceiver);
    }

    /**
     * @notice Authorize/deauthorize contract to send arbitration requests
     * @param contractAddr Contract address
     * @param authorized Whether to authorize or deauthorize
     */
    function setContractAuthorization(
        address contractAddr,
        bool authorized
    ) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
        emit ContractAuthorized(contractAddr, authorized);
    }

    /**
     * @notice Get fees for sending arbitration request
     * @param payFeesIn How fees will be paid
     */
    function getArbitrationFees(PayFeesIn payFeesIn) 
        external 
        view 
        returns (uint256) 
    {
        // Create sample message for fee calculation
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(oracleReceiver),
            data: abi.encode("sample"),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: 300_000})
            ),
            feeToken: payFeesIn == PayFeesIn.LINK ? address(i_linkToken) : address(0)
        });

        return i_router.getFee(oracleChainSelector, message);
    }

    /**
     * @notice Withdraw stuck tokens (emergency)
     */
    function withdrawToken(address token, address to, uint256 amount) 
        external 
        onlyOwner 
    {
        require(to != address(0), "Invalid recipient");
        LinkTokenInterface(token).transfer(to, amount);
    }

    /**
     * @notice Withdraw stuck native tokens (emergency)
     */
    function withdrawNative(address to) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        (bool success, ) = to.call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    // Allow contract to receive native tokens for fees
    receive() external payable {}
}