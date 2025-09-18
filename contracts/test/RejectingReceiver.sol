// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/// @notice Test helper that rejects any ETH transfers
contract RejectingReceiver {
	receive() external payable {
		revert("reject");
	}
	fallback() external payable {
		revert("reject");
	}
    
	/// @notice Helper: call ArbitrationService.applyResolutionToTarget from this contract
	/// so that msg.sender in the service is this contract's address (useful for tests)
	function callApplyResolution(address arbSvc, address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable {
		(bool ok, bytes memory ret) = arbSvc.call{value: msg.value}(abi.encodeWithSignature("applyResolutionToTarget(address,uint256,bool,uint256,address)", targetContract, caseId, approve, appliedAmount, beneficiary));
		require(ok, string(ret));
	}
}
