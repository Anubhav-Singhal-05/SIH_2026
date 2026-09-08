// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Shared custom error catalog.
/// @notice Errors derived from blockchain_team_spec.md §4 and the platform spec §6.
library Errors {
    // Permit verification
    error InvalidPermit();
    error CallerNotController();

    // IdentityRegistry
    error IdentityExists();
    error UnknownIdentity();
    error IdentityNotActive();
    error InvalidController();
    error InvalidStatusTransition();

    // MerkleRootRegistry
    error RootNotInitialized();
    error RootAlreadyInitialized();
    error RootVersionMismatch();
    error RootMismatch();
    error UnauthorizedRootWriter();
    error InvalidRoot();

    // AssetRegistry
    error UnknownAsset();
    error AssetAlreadyExists();
    error InvalidAssetId();
    error AssetInactive();
    error NotAssetOwner();
    error DestinationNotActive();
    error DocumentHashMismatch();
    error StaleRoot();
    error InvalidTransfer();
    error NotInheritanceExecutor();

    // AssetAccessRegistry
    error NotAuthorized();
    error InvalidPermissionMask();
    error PermissionExpired();
    error SelfGrantForbidden();

    // InheritanceRegistry
    error NomineeCannotActivate();
    error InsufficientAuthoritySignatures();
    error DuplicateAuthority();
    error InvalidBeneficiary();
    error InheritanceNotActive();
    error BatchTooLarge();
    error NoRuleSet();
    error ArrayLengthMismatch();
    error AuthoritySignatureExpired();

    // Shared
    error ContractPaused();
}
