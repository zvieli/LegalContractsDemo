// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AcceptingReceiver {
    receive() external payable {}

    // Allow this contract to call applyResolution on a service if necessary
    function callApplyResolution(address svc, address target, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external returns (bool) {
        (bool ok, ) = svc.call(abi.encodeWithSignature("applyResolutionToTarget(address,uint256,bool,uint256,address)", target, caseId, approve, appliedAmount, beneficiary));
        return ok;
    }
}
