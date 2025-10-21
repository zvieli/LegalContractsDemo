// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library Client {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
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
        // Note: ordering kept minimal for local testing
    }

    // Any2EVMMessage used by receivers when router calls back
    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender; // abi.encode(address)
        bytes data;   // payload
    }

    function _argsToBytes(EVMExtraArgsV1 memory args) internal pure returns (bytes memory) {
        return abi.encode(args);
    }
}
