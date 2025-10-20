// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

        // If we have a receiver address, try to call its ccipReceive function to simulate callback
        if (receiverAddress != address(0)) {
            // Build ABI encoded Any2EVMMessage as expected by CCIPArbitrationReceiver: (bytes32 messageId, uint64 sourceChainSelector, bytes sender, bytes data)
            bytes memory senderEncoded = abi.encode(msg.sender);
            uint64 sourceChainSelector = 0;
            // Prepare values to call receiver.ccipReceive(Any2EVMMessage)
            bytes4 selector = bytes4(keccak256("ccipReceive((bytes32,uint64,bytes,bytes))"));
            (bool ok, ) = receiverAddress.call(abi.encodeWithSelector(selector, messageId, sourceChainSelector, senderEncoded, message.data));
            // ignore success/failure but emit an event for visibility if failed
            // optionally, could emit an event here - but keep it simple
            // Note: some receivers may implement ccipReceive with an actual `Client.Any2EVMMessage` struct type; ABI encoding above should match expected tuple layout
            // If the call fails, tests can still manually call receiver functions to simulate behavior.
        }

        return messageId;
    }
}
