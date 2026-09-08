// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Permitted} from "./Permitted.sol";
import {Errors} from "./Errors.sol";
import {Types} from "./Types.sol";
import {MerkleLib} from "./Protocol.sol";

/// @title Per-DID Merkle root commitment registry.
/// @notice IdentityRegistry alone initializes roots; AssetRegistry alone
///         performs ordinary transitions. Every transition requires the exact
///         current root and version (spec §4 MerkleRootRegistry).
contract MerkleRootRegistry is Permitted {
    event MerkleRootUpdated(
        bytes32 indexed didHash,
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        uint64 oldVersion,
        uint64 newVersion,
        bytes32 operationHash
    );

    address public identityRegistry;
    address public assetRegistry;

    mapping(bytes32 => Types.RootRecord) public currentRoot;
    mapping(bytes32 => mapping(uint64 => Types.RootRecord)) public rootHistory;

    /// @notice Wired once by governance/deployer after dependent contracts
    ///         exist; asserted by the deployment script before it completes.
    function setWriters(address identityRegistry_, address assetRegistry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(identityRegistry == address(0) && assetRegistry == address(0), "writers already set");
        require(identityRegistry_ != address(0) && assetRegistry_ != address(0), "zero writer");
        identityRegistry = identityRegistry_;
        assetRegistry = assetRegistry_;
    }

    /// @notice The designated empty root (SHA256(0x02)) every identity starts at.
    function EMPTY_ROOT() external pure returns (bytes32) {
        return MerkleLib.EMPTY_ROOT();
    }

    /// @notice Initializes an identity's root at version 0. Only the
    ///         IdentityRegistry may call this, in the same transaction as
    ///         identity registration.
    function initializeRoot(bytes32 didHash, bytes32 initialRoot, bytes32 operationHash) external {
        if (msg.sender != identityRegistry) revert Errors.UnauthorizedRootWriter();
        if (initialRoot == bytes32(0)) revert Errors.InvalidRoot();
        if (currentRoot[didHash].updatedAt != 0) revert Errors.RootAlreadyInitialized();
        currentRoot[didHash] = Types.RootRecord({
            root: initialRoot,
            version: 0,
            updatedAt: uint64(block.timestamp),
            causeOperationHash: operationHash
        });
        rootHistory[didHash][0] = currentRoot[didHash];
        emit MerkleRootUpdated(didHash, bytes32(0), initialRoot, 0, 0, operationHash);
    }

    /// @notice Transitions a root one version forward. Requires the exact
    ///         current root and version; reverts StaleRoot otherwise.
    function transitionRoot(
        bytes32 didHash,
        bytes32 expectedOldRoot,
        uint64 expectedOldVersion,
        bytes32 newRoot,
        bytes32 operationHash
    ) external whenNotPaused {
        if (msg.sender != assetRegistry) revert Errors.UnauthorizedRootWriter();
        Types.RootRecord memory record = currentRoot[didHash];
        if (record.updatedAt == 0) revert Errors.RootNotInitialized();
        if (record.root != expectedOldRoot) revert Errors.StaleRoot();
        if (record.version != expectedOldVersion) revert Errors.RootVersionMismatch();
        if (newRoot == bytes32(0)) revert Errors.InvalidRoot();
        uint64 newVersion = expectedOldVersion + 1;
        currentRoot[didHash] = Types.RootRecord({
            root: newRoot,
            version: newVersion,
            updatedAt: uint64(block.timestamp),
            causeOperationHash: operationHash
        });
        rootHistory[didHash][newVersion] = currentRoot[didHash];
        emit MerkleRootUpdated(didHash, expectedOldRoot, newRoot, expectedOldVersion, newVersion, operationHash);
    }

    function getCurrentRoot(bytes32 didHash)
        external
        view
        returns (bytes32 root, uint64 version, uint64 updatedAt)
    {
        Types.RootRecord memory record = currentRoot[didHash];
        if (record.updatedAt == 0) revert Errors.RootNotInitialized();
        return (record.root, record.version, record.updatedAt);
    }

    function getRootAtVersion(bytes32 didHash, uint64 version)
        external
        view
        returns (bytes32 root, uint64 updatedAt, bytes32 causeOperationHash)
    {
        Types.RootRecord memory record = rootHistory[didHash][version];
        if (record.updatedAt == 0) revert Errors.RootNotInitialized();
        return (record.root, record.updatedAt, record.causeOperationHash);
    }
}
