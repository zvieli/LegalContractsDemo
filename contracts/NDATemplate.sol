// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract NDATemplate is EIP712 {
    using ECDSA for bytes32;

    address public partyA;
    address public partyB;
    bool public signedByA;
    bool public signedByB;

    bytes32 private constant NDA_TYPEHASH =
        keccak256("NDA(address contractAddress)");

    constructor(address _partyA, address _partyB)
        EIP712("NDATemplate", "1")
    {
        partyA = _partyA;
        partyB = _partyB;
    }

    function hashMessage() public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            NDA_TYPEHASH,
            address(this)
        )));
    }

    function signNDA(bytes memory signature) external {
        bytes32 digest = hashMessage();
        address signer = ECDSA.recover(digest, signature);

        if (signer == partyA) signedByA = true;
        else if (signer == partyB) signedByB = true;
        else revert("Invalid signer");
    }

    function isFullySigned() public view returns (bool) {
        return signedByA && signedByB;
    }
}
