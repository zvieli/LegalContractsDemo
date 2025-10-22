// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Helper contract that attempts reentrancy into a rent contract's withdrawPayments
contract ReentrantReceiver {
    address public target;
    constructor() {}

    function setTarget(address _target) external {
        target = _target;
    }

    // This contract will attempt to call withdrawPayments on the rent contract when receiving ETH
    receive() external payable {
        if (target != address(0)) {
            // attempt reentrancy: call withdrawPayments on the target
            (bool ok, ) = target.call(abi.encodeWithSignature("withdrawPayments()"));
            // ignore result; we're testing whether the rent contract protects itself
            ok;
        }
    }
}
