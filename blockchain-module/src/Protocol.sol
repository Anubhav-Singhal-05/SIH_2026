// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Deterministic Merkle helpers per platform spec §7.
/// @notice Cross-language golden-vector definitions. The off-chain
///         packages/protocol implementation MUST produce identical values.
library MerkleLib {
    bytes1 internal constant LEAF_PREFIX = 0x00;
    bytes1 internal constant PARENT_PREFIX = 0x01;
    bytes1 internal constant EMPTY_ROOT_PREFIX = 0x02;

    /// @notice EMPTY_ROOT = SHA256(0x02).
    function EMPTY_ROOT() internal pure returns (bytes32) {
        return sha256(abi.encodePacked(EMPTY_ROOT_PREFIX));
    }

    /// @notice leaf(asset) =
    ///         SHA256(0x00 || assetId[32] || ownerDidHash[32] || documentHash[32]
    ///                || metadataHash[32] || documentVersion[8])
    function leaf(
        uint256 assetId,
        bytes32 ownerDidHash,
        bytes32 documentHash,
        bytes32 metadataHash,
        uint64 documentVersion
    ) internal pure returns (bytes32) {
        return sha256(
            abi.encodePacked(
                LEAF_PREFIX,
                bytes32(assetId),
                ownerDidHash,
                documentHash,
                metadataHash,
                bytes8(documentVersion)
            )
        );
    }

    /// @notice parent(left, right) = SHA256(0x01 || left[32] || right[32]).
    function parent(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(PARENT_PREFIX, left, right));
    }
}

/// @title Operation hash computation.
/// @notice operationHash = keccak256(abi.encode(
///             chainId, target, selector, initiatorDidHash, nonce, expiresAt, keccak256(canonicalArgs)))
///         Must match packages/protocol byte-for-byte (BC-DEPLOY-012).
library OperationHash {
    function compute(
        address target,
        bytes4 selector,
        bytes32 didHash,
        uint64 nonce,
        uint64 expiresAt,
        bytes memory canonicalArgs
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, target, selector, didHash, nonce, expiresAt, keccak256(canonicalArgs))
        );
    }
}
