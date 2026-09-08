// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Shared types for the blockchain platform registries.
/// @notice Derived from blockchain_team_spec.md §3–§4 and the platform spec §6.
library Types {
    // ------------------------------------------------------------------
    // Step-up permit (spec §3)
    // ------------------------------------------------------------------
    struct StepUpPermit {
        bytes32 operationHash;
        bytes32 didHash;
        uint64 expiresAt;
        uint64 nonce;
        bytes signature;
    }

    // ------------------------------------------------------------------
    // Identity
    // ------------------------------------------------------------------
    enum IdentityStatus {
        NONE,
        ACTIVE,
        SUSPENDED,
        DEACTIVATED
    }

    struct Identity {
        address controller;
        bytes32 encryptionKeyHash;
        bytes32 recoveryConfigHash;
        IdentityStatus status;
        uint64 createdAt;
        uint64 updatedAt;
    }

    // ------------------------------------------------------------------
    // Merkle roots
    // ------------------------------------------------------------------
    struct RootRecord {
        bytes32 root;
        uint64 version;
        uint64 updatedAt;
        bytes32 causeOperationHash;
    }

    // ------------------------------------------------------------------
    // Assets
    // ------------------------------------------------------------------
    enum AssetStatus {
        NONE,
        ACTIVE,
        DEACTIVATED
    }

    struct Asset {
        bytes32 ownerDid;
        bytes32 documentHash;
        bytes32 metadataHash;
        bytes32 storageRefCommitment;
        uint32 documentVersion;
        AssetStatus status;
    }

    // ------------------------------------------------------------------
    // Access
    // ------------------------------------------------------------------
    struct Permission {
        uint16 mask;
        uint64 expiresAt;
        bool active;
        uint64 updatedAt;
    }

    // ------------------------------------------------------------------
    // Inheritance
    // ------------------------------------------------------------------
    enum InheritanceStatus {
        NONE,
        ACTIVE,
        ACTIVATED,
        CLOSED
    }

    struct AuthoritySignature {
        address authority;
        bytes signature;
    }

    struct RootTransition {
        bytes32 didHash;
        bytes32 oldRoot;
        uint64 oldVersion;
        bytes32 newRoot;
    }
}
