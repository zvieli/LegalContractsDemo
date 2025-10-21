// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CCIPArbitrationTypes} from "../Arbitration/ccip/CCIPArbitrationTypes.sol";

// Minimal shim of Chainlink Client library types used by CCIP contracts
library Client {
    struct EVMTokenAmount {
        address token; // token address
        uint256 amount; // amount
    }

    struct EVMExtraArgsV1 {
        uint256 gasLimit;
    }

    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        address feeToken;
        bytes extraArgs;
    }

    function _argsToBytes(EVMExtraArgsV1 memory args) internal pure returns (bytes memory) {
        return abi.encode(args);
    }
}

    // Any2EVMMessage used by receivers when router calls back
    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender; // abi.encode(address)
        bytes data;   // payload
    }

interface IRouterClientLocal {
    function getFee(uint64 /*destinationChainSelector*/, Client.EVM2AnyMessage calldata /*message*/) external view returns (uint256);
    function ccipSend(uint64 /*destinationChainSelector*/, Client.EVM2AnyMessage calldata /*message*/) external payable returns (bytes32);
}

contract MockCCIPRouter is IRouterClientLocal {
    // fixed fee to return for getFee
    uint256 public fixedFee;
    event CCIPSent(bytes32 indexed messageId, uint64 chainSelector, address sender);

    constructor(uint256 _fixedFee) {
        fixedFee = _fixedFee;
    }

    function setFixedFee(uint256 f) external {
        fixedFee = f;
    }

    function getFee(uint64 /*destinationChainSelector*/, Client.EVM2AnyMessage calldata /*message*/) external view override returns (uint256) {
        return fixedFee;
    }

    function ccipSend(uint64 /*destinationChainSelector*/, Client.EVM2AnyMessage calldata message) external payable override returns (bytes32) {
        // generate a pseudo-random message id
        bytes32 messageId = keccak256(abi.encodePacked(block.timestamp, msg.sender, address(this)));
        emit CCIPSent(messageId, /*chain*/ 0, msg.sender);

        // Try to decode receiver address from message.receiver (expected to be abi.encode(address))
        address receiverAddress = address(0);
        if (message.receiver.length >= 20) {
            bytes memory recv = message.receiver;
            bytes32 dataWord;
            assembly { dataWord := mload(add(recv, 32)) }
            receiverAddress = address(uint160(uint256(dataWord)));
        }

        // In this local mock we emit the CCIPSent event only. We do not call the receiver
        // immediately to better emulate asynchronous CCIP delivery. Tests should use
        // `simulateDecisionTo` to trigger delivery of DECISION messages later.

        return messageId;
    }

    /// @notice Simulate delivering a DECISION message to a receiver (for local E2E tests)
    function simulateDecisionTo(
        address receiver,
        bytes32 messageId,
        uint64 sourceChainSelector,
        address requestSender,
        bytes32 disputeId,
        bool approved,
        uint256 appliedAmount,
        address beneficiary,
        string calldata rationale,
        bytes32 oracleId,
        address targetContract,
        uint256 caseId
    ) external {
        // Build ArbitrationDecision struct ABI encoding
        CCIPArbitrationTypes.ArbitrationDecision memory decision = CCIPArbitrationTypes.ArbitrationDecision({
            disputeId: disputeId,
            approved: approved,
            appliedAmount: appliedAmount,
            beneficiary: beneficiary,
            rationale: rationale,
            oracleId: oracleId,
            timestamp: block.timestamp,
            targetContract: targetContract,
            caseId: caseId
        });

        // Build CCIPMessage of type DECISION
        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = CCIPArbitrationTypes.CCIPMessage({
            messageType: CCIPArbitrationTypes.MessageType.DECISION,
            data: abi.encode(decision)
        });

        // ABI encode the message that receivers expect: Any2EVMMessage(messageId, sourceChainSelector, abi.encode(sender), abi.encode(ccipMsg))
    // Use the provided requestSender (the original contract that issued the request) as the encoded sender
    bytes memory senderEncoded = abi.encode(requestSender);
    bytes memory payload = abi.encode(messageId, sourceChainSelector, senderEncoded, abi.encode(ccipMsg));

        // Call the receiver
        bytes4 selector = bytes4(keccak256("ccipReceive((bytes32,uint64,bytes,bytes))"));
        // swallow failures to keep simulation non-fatal
    // Call the receiver via the raw entrypoint we added for testing: ccipReceiveRaw(bytes32,uint64,bytes,bytes)
    bytes4 rawSelector = bytes4(keccak256("ccipReceiveRaw(bytes32,uint64,bytes,bytes)"));
    (bool ok, bytes memory ret) = receiver.call(abi.encodeWithSelector(rawSelector, messageId, sourceChainSelector, senderEncoded, abi.encode(ccipMsg)));
        if (!ok) {
            // If the receiver reverted with a reason, bubble it up for easier debugging
            if (ret.length > 0) {
                // revert with the same reason
                assembly {
                    let returndata_size := mload(ret)
                    let returndata_ptr := add(ret, 32)
                    revert(returndata_ptr, returndata_size)
                }
            }
            revert("simulateDecision: receiver call failed");
        }
    }
}
