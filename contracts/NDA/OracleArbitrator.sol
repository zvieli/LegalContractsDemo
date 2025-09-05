// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INDATemplateLite {
    function deposits(address party) external view returns (uint256);
    function resolveByArbitrator(uint256 caseId, bool approve, address beneficiary) external;
    function enforcePenalty(address guiltyParty, uint256 penaltyAmount, address beneficiary) external;
    function getCase(uint256 caseId) external view returns (
        address reporter,
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash,
        bool resolved,
        bool approved,
        uint256 approveVotes,
        uint256 rejectVotes
    );
    function arbitrator() external view returns (address);
}

contract OracleArbitrator {
    address public immutable owner;
    address public router; // Chainlink Functions router (or designated fulfiller)

    struct RequestMeta {
        address nda;
        uint256 caseId;
        address reporter;
        address offender;
        bool fulfilled;
    }

    mapping(bytes32 => RequestMeta) public requests; // requestId => meta
    mapping(bytes32 => bool) public caseUsed; // key(nda,caseId) => used

    event RouterUpdated(address indexed router);
    event ResolutionRequested(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, address reporter, address offender);
    event ResolutionFulfilled(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, bool approve, uint256 penalty, address beneficiary, address guilty);
    event ResolutionFailed(bytes32 indexed requestId, string reason);

    modifier onlyOwner() { require(msg.sender == owner, "Only owner"); _; }
    modifier onlyRouterOrOwner() { require(msg.sender == router || msg.sender == owner, "Only router/owner"); _; }

    constructor(address _router) {
        owner = msg.sender;
        router = _router;
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
        emit RouterUpdated(_router);
    }

    function _caseKey(address nda, uint256 caseId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(nda, caseId));
    }

    function requestResolution(
        address nda,
        uint256 caseId,
        address offender,
        bytes calldata /* evidenceRef */
    ) external returns (bytes32 requestId) {
        require(nda != address(0), "Invalid NDA");
        INDATemplateLite n = INDATemplateLite(nda);
        require(n.arbitrator() == address(this), "Not NDA arbitrator");
        (, , , , bool resolved, , , ) = n.getCase(caseId);
        require(!resolved, "Case resolved");

        bytes32 key = _caseKey(nda, caseId);
        require(!caseUsed[key], "Already requested");

        // pseudo request id; in production comes from Functions
        requestId = keccak256(abi.encodePacked(block.chainid, block.number, nda, caseId, msg.sender));

        requests[requestId] = RequestMeta({
            nda: nda,
            caseId: caseId,
            reporter: msg.sender,
            offender: offender,
            fulfilled: false
        });
        caseUsed[key] = true;

        emit ResolutionRequested(requestId, nda, caseId, msg.sender, offender);
    }

    // Fulfill from Chainlink Functions (or owner in tests)
    function fulfill(
        bytes32 requestId,
        bool approve,
        uint256 penaltyWei,
        address beneficiary,
        address guilty
    ) external onlyRouterOrOwner {
        RequestMeta storage meta = requests[requestId];
        require(meta.nda != address(0), "Unknown request");
        require(!meta.fulfilled, "Already fulfilled");
        require(beneficiary != address(0), "Invalid beneficiary");

        INDATemplateLite n = INDATemplateLite(meta.nda);

        // Clamp penalty to offender's deposit
        uint256 available = n.deposits(guilty);
        if (penaltyWei > available) {
            penaltyWei = available;
        }

        // Execute penalties first, then resolve
        if (penaltyWei > 0) {
            n.enforcePenalty(guilty, penaltyWei, beneficiary);
        }
        n.resolveByArbitrator(meta.caseId, approve, beneficiary);

        meta.fulfilled = true;
        emit ResolutionFulfilled(requestId, meta.nda, meta.caseId, approve, penaltyWei, beneficiary, guilty);
    }
}
