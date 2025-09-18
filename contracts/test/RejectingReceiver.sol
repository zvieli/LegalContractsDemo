// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RejectingReceiver {
    receive() external payable { revert("reject"); }
    fallback() external payable { revert("reject"); }

    // helper to call ArbitrationService.applyResolutionToTarget via this contract
    function callApplyResolution(address svc, address target, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external returns (bool) {
        (bool ok, ) = svc.call(abi.encodeWithSignature("applyResolutionToTarget(address,uint256,bool,uint256,address)", target, caseId, approve, appliedAmount, beneficiary));
        return ok;
    }
}
