// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Permitted} from "./Permitted.sol";
import {Errors} from "./Errors.sol";
import {Types} from "./Types.sol";
import {MerkleLib} from "./Protocol.sol";

/// @title DID identity registry.
/// @notice State machine: NONE -> ACTIVE -> SUSPENDED -> ACTIVE, and
///         ACTIVE -> DEACTIVATED (terminal). Registration atomically
///         initializes the identity's Merkle root at version 0 with the
///         designated EMPTY_ROOT (spec §4 IdentityRegistry).
contract IdentityRegistry is Permitted {
    event IdentityRegistered(
        bytes32 indexed didHash, address indexed controller, bytes32 encryptionKeyHash, bytes32 recoveryConfigHash
    );
    event IdentityControllerRotated(
        bytes32 indexed didHash, address indexed oldController, address indexed newController, bytes32 newEncryptionKeyHash
    );
    event IdentityStatusChanged(
        bytes32 indexed didHash, Types.IdentityStatus oldStatus, Types.IdentityStatus newStatus
    );

    bytes32 private constant _EMPTY_ROOT = bytes32(0);

    mapping(bytes32 => Types.Identity) private _identities;

    IMerkleRootRegistry public immutable merkleRootRegistry;

    constructor(address merkleRootRegistry_) {
        merkleRootRegistry = IMerkleRootRegistry(merkleRootRegistry_);
    }

    function registerIdentity(
        bytes32 didHash,
        address controller,
        bytes32 encryptionKeyHash,
        bytes32 recoveryConfigHash,
        bytes32 initialRoot,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        if (controller == address(0)) revert Errors.InvalidController();
        if (initialRoot != MerkleLib.EMPTY_ROOT()) revert Errors.InvalidRoot();
        // Verify and consume the permit BEFORE domain checks/effects
        // (BC-PERMIT-011: nonce consumed strictly before effects).
        _verifyPermit(permit, didHash);
        if (msg.sender != controller) revert Errors.CallerNotController();
        if (_identities[didHash].status != Types.IdentityStatus.NONE) revert Errors.IdentityExists();

        _identities[didHash] = Types.Identity({
            controller: controller,
            encryptionKeyHash: encryptionKeyHash,
            recoveryConfigHash: recoveryConfigHash,
            status: Types.IdentityStatus.ACTIVE,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });

        // Atomic root initialization at version 0.
        merkleRootRegistry.initializeRoot(didHash, initialRoot, permit.operationHash);

        emit IdentityRegistered(didHash, controller, encryptionKeyHash, recoveryConfigHash);
    }

    function rotateController(
        bytes32 didHash,
        address newController,
        bytes32 newEncryptionKeyHash,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        Types.Identity storage identity = _identities[didHash];
        if (identity.status == Types.IdentityStatus.NONE) revert Errors.UnknownIdentity();
        if (identity.status != Types.IdentityStatus.ACTIVE) revert Errors.IdentityNotActive();
        if (newController == address(0)) revert Errors.InvalidController();
        _verifyPermit(permit, didHash);
        if (msg.sender != identity.controller) revert Errors.CallerNotController();

        address oldController = identity.controller;
        identity.controller = newController;
        identity.encryptionKeyHash = newEncryptionKeyHash;
        identity.updatedAt = uint64(block.timestamp);

        // Assets stay bound to the DID, not the address: no asset sweep occurs.
        emit IdentityControllerRotated(didHash, oldController, newController, newEncryptionKeyHash);
    }

    function setIdentityStatus(bytes32 didHash, Types.IdentityStatus status, Types.StepUpPermit calldata permit)
        external
        whenNotPaused
    {
        Types.Identity storage identity = _identities[didHash];
        if (identity.status == Types.IdentityStatus.NONE) revert Errors.UnknownIdentity();
        // Allowed transitions: ACTIVE -> SUSPENDED, SUSPENDED -> ACTIVE,
        // ACTIVE -> DEACTIVATED. DEACTIVATED is terminal.
        if (status == Types.IdentityStatus.NONE || status == Types.IdentityStatus.DEACTIVATED) {
            if (identity.status != Types.IdentityStatus.ACTIVE) revert Errors.InvalidStatusTransition();
        } else if (
            (status == Types.IdentityStatus.SUSPENDED && identity.status != Types.IdentityStatus.ACTIVE)
                || (status == Types.IdentityStatus.ACTIVE && identity.status != Types.IdentityStatus.SUSPENDED)
        ) {
            revert Errors.InvalidStatusTransition();
        }
        _verifyPermit(permit, didHash);

        Types.IdentityStatus oldStatus = identity.status;
        identity.status = status;
        identity.updatedAt = uint64(block.timestamp);
        emit IdentityStatusChanged(didHash, oldStatus, status);
    }

    function resolveIdentity(bytes32 didHash) external view returns (Types.Identity memory) {
        return _identities[didHash];
    }

    function controllerOf(bytes32 didHash) external view returns (address) {
        Types.Identity storage identity = _identities[didHash];
        if (identity.status == Types.IdentityStatus.NONE) revert Errors.UnknownIdentity();
        return identity.controller;
    }

    function isActive(bytes32 didHash) external view returns (bool) {
        return _identities[didHash].status == Types.IdentityStatus.ACTIVE;
    }
}

interface IMerkleRootRegistry {
    function initializeRoot(bytes32 didHash, bytes32 initialRoot, bytes32 operationHash) external;
}
