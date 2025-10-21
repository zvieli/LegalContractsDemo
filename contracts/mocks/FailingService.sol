// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FailingService {
    event Called(bytes32 messageId);
    function authorizeCCIPReceiver(address, bool) external {}
    // Instead of reverting, return a short failure payload so callers using low-level
    // .call can inspect the returned bytes and treat it as a controlled failure.
    // We return a one-byte status (0 = failure, 1 = success) followed by an optional message.
    function receiveCCIPDecisionRaw(bytes32, address, uint256, bytes calldata) external pure {
        bytes memory payload = abi.encodePacked(uint8(0));
        assembly {
            let ptr := add(payload, 32)
            let len := mload(payload)
            return(ptr, len)
        }
    }
}
