// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_3_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";

interface INDATemplateLite2 {
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

contract OracleArbitratorFunctions is FunctionsClient {
    using FunctionsRequest for FunctionsRequest.Request;
    address public immutable owner;

    // Chainlink Functions config
    uint64 public subscriptionId; // Functions billing subscription
    bytes32 public donId; // e.g., 0x...
    uint32 public gasLimit; // callback gas limit for Functions
    string public source; // inline JS source for Functions (keep short or set via event-driven off-chain)

    struct RequestMeta {
        address nda;
        uint256 caseId;
        address reporter;
        address offender;
        bool fulfilled;
    }

    mapping(bytes32 => RequestMeta) public requests; // requestId => meta
    mapping(bytes32 => bool) public caseUsed; // key(nda,caseId) => used

    event ConfigUpdated(uint64 subscriptionId, bytes32 donId);
    event FunctionsConfigUpdated(uint64 subscriptionId, bytes32 donId, uint32 gasLimit, string source);
    event ResolutionRequested(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, address reporter, address offender);
    event ResolutionFulfilled(bytes32 indexed requestId, address indexed nda, uint256 indexed caseId, bool approve, uint256 penalty, address beneficiary, address guilty);

    modifier onlyOwner() { require(msg.sender == owner, "Only owner"); _; }

    constructor(address _router) FunctionsClient(_router) {
        owner = msg.sender;
    }

    function setConfig(uint64 _subscriptionId, bytes32 _donId) external onlyOwner {
        subscriptionId = _subscriptionId;
        donId = _donId;
        emit ConfigUpdated(_subscriptionId, _donId);
    }

    function setFunctionsConfig(uint64 _subscriptionId, bytes32 _donId, uint32 _gasLimit, string calldata _source) external onlyOwner {
        subscriptionId = _subscriptionId;
        donId = _donId;
        gasLimit = _gasLimit;
        source = _source;
        emit FunctionsConfigUpdated(_subscriptionId, _donId, _gasLimit, _source);
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
        INDATemplateLite2 n = INDATemplateLite2(nda);
        require(n.arbitrator() == address(this), "Not NDA arbitrator");
        (, , , , bool resolved, , , ) = n.getCase(caseId);
        require(!resolved, "Case resolved");

        bytes32 key = _caseKey(nda, caseId);
        require(!caseUsed[key], "Already requested");

        // If Functions is fully configured (subscription, DON, gas and source), send a real request.
        if (_functionsEnabled()) {
            // Prepare the request payload with inline JavaScript source.
            FunctionsRequest.Request memory req;
            req.initializeRequestForInlineJavaScript(source);
            // Build arguments for the AI script: [chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash]
            (
                string memory chainIdStr,
                string memory ndaStr,
                string memory caseIdStr,
                string memory reporterStr,
                string memory offenderStr,
                string memory requestedPenaltyStr,
                string memory evidenceHashStr
            ) = _buildArgs(nda, caseId, msg.sender, offender, n);

            string[] memory args = new string[](7);
            args[0] = chainIdStr;
            args[1] = ndaStr;
            args[2] = caseIdStr;
            args[3] = reporterStr;
            args[4] = offenderStr;
            args[5] = requestedPenaltyStr;
            args[6] = evidenceHashStr;
            req.setArgs(args);

            // Note: secrets (e.g., API keys) should be configured via DON-hosted secrets or encrypted secrets; omitted here.
            requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);
        } else {
            // For local/testing derive a deterministic id and allow test fulfillment.
            requestId = keccak256(abi.encodePacked(block.chainid, block.number, nda, caseId, msg.sender));
        }

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

    // Chainlink Functions callback; called by router in production (v1_3_0 uses _fulfillRequest)
    function _fulfillRequest(bytes32 requestId, bytes memory response, bytes memory /* err */) internal override {
        RequestMeta storage meta = requests[requestId];
        require(meta.nda != address(0), "Unknown request");
        require(!meta.fulfilled, "Already fulfilled");

        (bool approve, uint256 penaltyWei, address beneficiary, address guilty) = abi.decode(response, (bool, uint256, address, address));
        require(beneficiary != address(0), "Invalid beneficiary");

        INDATemplateLite2 n = INDATemplateLite2(meta.nda);
        uint256 available = n.deposits(guilty);
        if (penaltyWei > available) penaltyWei = available;

        if (penaltyWei > 0) {
            n.enforcePenalty(guilty, penaltyWei, beneficiary);
        }
        n.resolveByArbitrator(meta.caseId, approve, beneficiary);

        meta.fulfilled = true;
        emit ResolutionFulfilled(requestId, meta.nda, meta.caseId, approve, penaltyWei, beneficiary, guilty);
    }

    // Test-only helper to simulate router callback
    function testFulfill(bytes32 requestId, bool approve, uint256 penaltyWei, address beneficiary, address guilty) external onlyOwner {
        bytes memory resp = abi.encode(approve, penaltyWei, beneficiary, guilty);
        _fulfillRequest(requestId, resp, "");
    }

    // -----------------------
    // Internal helpers
    // -----------------------
    function _functionsEnabled() internal view returns (bool) {
        return subscriptionId != 0 && donId != bytes32(0) && gasLimit != 0 && bytes(source).length > 0;
    }

    function _buildArgs(
        address nda,
        uint256 caseId,
        address reporter,
        address offender,
        INDATemplateLite2 n
    ) internal view returns (
        string memory chainIdStr,
        string memory ndaStr,
        string memory caseIdStr,
        string memory reporterStr,
        string memory offenderStr,
        string memory requestedPenaltyStr,
        string memory evidenceHashStr
    ) {
        (
            ,
            ,
            uint256 requestedPenalty,
            bytes32 evidenceHash,
            ,
            ,
            ,
            
        ) = n.getCase(caseId);
        chainIdStr = _uintToString(block.chainid);
        ndaStr = _addrToString(nda);
        caseIdStr = _uintToString(caseId);
        reporterStr = _addrToString(reporter);
        offenderStr = _addrToString(offender);
        requestedPenaltyStr = _uintToString(requestedPenalty);
        evidenceHashStr = _bytes32ToHexString(evidenceHash);
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _addrToString(address account) internal pure returns (string memory) {
        bytes20 data = bytes20(account);
        bytes memory hexChars = new bytes(40);
        bytes16 hexSymbols = 0x30313233343536373839616263646566; // "0123456789abcdef"
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(data[i]);
            hexChars[2 * i] = bytes1(hexSymbols[b >> 4]);
            hexChars[2 * i + 1] = bytes1(hexSymbols[b & 0x0f]);
        }
        return string(abi.encodePacked("0x", hexChars));
    }

    function _bytes32ToHexString(bytes32 data) internal pure returns (string memory) {
        bytes memory hexChars = new bytes(64);
        bytes16 hexSymbols = 0x30313233343536373839616263646566; // "0123456789abcdef"
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(data[i]);
            hexChars[2 * i] = bytes1(hexSymbols[b >> 4]);
            hexChars[2 * i + 1] = bytes1(hexSymbols[b & 0x0f]);
        }
        return string(abi.encodePacked("0x", hexChars));
    }
}
