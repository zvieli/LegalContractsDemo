// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Use local shims for editor and local testing
import {IRouterClientLocal as IRouterClient} from "./IRouterClientLocal.sol";
import {Client} from "./LocalClient.sol";
import {LinkTokenInterface} from "./LinkTokenInterface.sol";
import {CCIPArbitrationTypes} from "./CCIPArbitrationTypes.sol";

/**
 * @title CCIPArbitrationSender
 * @notice Sends arbitration requests and decisions via CCIP to Oracle network
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

    event ArbitrationDecisionSent(
        bytes32 indexed messageId,
        bytes32 indexed disputeId,
        address indexed contractAddress,
        uint256 caseId,
        bool approved,
        uint16 confidence
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

        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = 
            CCIPArbitrationTypes.CCIPMessage({
                messageType: CCIPArbitrationTypes.MessageType.REQUEST,
                data: abi.encode(request)
            });

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(oracleReceiver),
            data: abi.encode(ccipMsg),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: 300_000})
            ),
            feeToken: payFeesIn == PayFeesIn.LINK ? address(i_linkToken) : address(0)
        });

        uint256 fees = i_router.getFee(oracleChainSelector, message);
        
        if (payFeesIn == PayFeesIn.LINK) {
            i_linkToken.transferFrom(msg.sender, address(this), fees);
            i_linkToken.approve(address(i_router), fees);
        } else {
            require(msg.value >= fees, "Insufficient native for fees");
        }

        messageId = i_router.ccipSend{value: payFeesIn == PayFeesIn.Native ? fees : 0}(
            oracleChainSelector,
            message
        );

        pendingRequests[messageId] = request;

        emit ArbitrationRequestSent(messageId, disputeId, contractAddress, caseId);
        
        return messageId;
    }

    /**
     * @notice Send arbitration decision via CCIP
     * @dev Mirrors sendArbitrationRequest but for arbitration verdicts
     */
    function sendArbitrationDecision(
    bytes32 disputeId,
    bool approved,
    uint256 appliedAmount,
    address beneficiary,
    string calldata rationale,
    bytes32 oracleId,
    PayFeesIn payFeesIn
    ) external payable onlyAuthorizedContract returns (bytes32 messageId) {
        
        // Build decision payload (only required fields)
        CCIPArbitrationTypes.ArbitrationDecision memory decision =
            CCIPArbitrationTypes.ArbitrationDecision({
                disputeId: disputeId,
                approved: approved,
                appliedAmount: appliedAmount,
                beneficiary: beneficiary,
                rationale: rationale,
                oracleId: oracleId,
                timestamp: block.timestamp,
                targetContract: address(0),
                caseId: 0
            });

        // Encode as CCIP message
        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = 
            CCIPArbitrationTypes.CCIPMessage({
                messageType: CCIPArbitrationTypes.MessageType.DECISION,
                data: abi.encode(decision)
            });

        // Create CCIP message
            Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
                receiver: abi.encode(oracleReceiver),
                data: abi.encode(ccipMsg),
                tokenAmounts: new Client.EVMTokenAmount[](0),
                extraArgs: Client._argsToBytes(
                    Client.EVMExtraArgsV1({gasLimit: 400_000})
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

        // Send via router
        messageId = i_router.ccipSend{value: payFeesIn == PayFeesIn.Native ? fees : 0}(
            oracleChainSelector,
            message
        );

        emit ArbitrationDecisionSent(
            messageId,
            disputeId,
            beneficiary,
            appliedAmount,
            approved,
            0 // confidence not in struct or event, set to 0 or remove from event if not needed
        );

        return messageId;
    }

    /**
     * @notice Update oracle configuration
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
     */
    function getArbitrationFees(PayFeesIn payFeesIn) 
        external 
        view 
        returns (uint256) 
    {
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

    receive() external payable {}
}
