// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Permitted} from "./Permitted.sol";
import {Errors} from "./Errors.sol";
import {Types} from "./Types.sol";
import {ECDSA} from "openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Inheritance rule, activation, and execution registry.
/// @notice Activation requires two distinct valid EIP-712 authority
///         signatures from the initial three-authority set; a nominee can
///         never activate (spec §4 InheritanceRegistry, invariant INV-08).
///         Execution is limited to 50 assets per batch and only to the
///         default nominee or the matching per-asset override, routed through
///         the restricted AssetRegistry inheritance transfer path.
contract InheritanceRegistry is Permitted {
    event InheritanceRuleSet(
        bytes32 indexed ownerDidHash,
        bytes32 indexed defaultNomineeDidHash,
        bytes32 policyHash,
        uint256[] assetIds,
        bytes32[] beneficiaryDids
    );
    event InheritanceActivated(
        bytes32 indexed ownerDidHash, bytes32 evidenceHash, uint256 authoritySetVersion, uint64 activationNonce
    );
    event InheritanceBatchExecuted(bytes32 indexed ownerDidHash, uint256[] assetIds, bytes32[] beneficiaryDids);
    event InheritanceClosed(bytes32 indexed ownerDidHash);

    bytes32 public constant INHERITANCE_AUTHORITY_ROLE = keccak256("INHERITANCE_AUTHORITY_ROLE");
    bytes32 public constant INHERITANCE_EXECUTOR_ROLE = keccak256("INHERITANCE_EXECUTOR_ROLE");

    uint256 public constant AUTHORITY_THRESHOLD = 2;
    uint256 public constant MAX_BATCH = 50;

    bytes32 private constant _ACTIVATION_TYPEHASH =
        keccak256(
            "InheritanceActivation(bytes32 ownerDidHash,bytes32 evidenceHash,uint256 authoritySetVersion,"
            "uint64 activationNonce,uint64 expiresAt)"
        );

    struct Rule {
        bytes32 defaultNomineeDidHash;
        bytes32 policyHash;
        Types.InheritanceStatus status;
        uint64 activationNonce;
        uint256 authoritySetVersion;
    }

    mapping(bytes32 => Rule) public rules;
    mapping(bytes32 => mapping(uint256 => bytes32)) public assetOverride; // ownerDid => assetId => beneficiaryDid

    address public identityRegistry;
    address public assetRegistry;

    /// @notice Wired once by governance/deployer after the AssetRegistry exists.
    function setWriters(address identityRegistry_, address assetRegistry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(identityRegistry == address(0) && assetRegistry == address(0), "writers already set");
        require(identityRegistry_ != address(0) && assetRegistry_ != address(0), "zero writer");
        identityRegistry = identityRegistry_;
        assetRegistry = assetRegistry_;
    }

    // ------------------------------------------------------------------
    // Rule configuration
    // ------------------------------------------------------------------
    function setInheritanceRule(
        bytes32 ownerDidHash,
        bytes32 defaultNomineeDidHash,
        uint256[] calldata assetIds,
        bytes32[] calldata beneficiaryDids,
        bytes32 policyHash,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        if (!IIdentityRegistry(identityRegistry).isActive(ownerDidHash)) revert Errors.IdentityNotActive();
        if (assetIds.length != beneficiaryDids.length) revert Errors.ArrayLengthMismatch();
        if (defaultNomineeDidHash == bytes32(0) || defaultNomineeDidHash == ownerDidHash) {
            revert Errors.InvalidBeneficiary();
        }
        _verifyPermit(permit, ownerDidHash);
        if (msg.sender != IIdentityRegistry(identityRegistry).controllerOf(ownerDidHash)) revert Errors.CallerNotController();

        rules[ownerDidHash] = Rule({
            defaultNomineeDidHash: defaultNomineeDidHash,
            policyHash: policyHash,
            status: Types.InheritanceStatus.NONE,
            activationNonce: 0,
            authoritySetVersion: 0
        });
        for (uint256 i = 0; i < assetIds.length; ++i) {
            if (beneficiaryDids[i] == ownerDidHash) revert Errors.InvalidBeneficiary();
            assetOverride[ownerDidHash][assetIds[i]] = beneficiaryDids[i];
        }
        emit InheritanceRuleSet(ownerDidHash, defaultNomineeDidHash, policyHash, assetIds, beneficiaryDids);
    }

    function getRule(bytes32 ownerDidHash) external view returns (Rule memory) {
        return rules[ownerDidHash];
    }
    // ------------------------------------------------------------------
    // Activation
    // ------------------------------------------------------------------
    /// @notice Activates the rule with AUTHORITY_THRESHOLD distinct valid
    ///         authority signatures. A nominee signature never counts.
    function activateInheritance(
        bytes32 ownerDidHash,
        bytes32 evidenceHash,
        uint256 authoritySetVersion,
        uint64 expiresAt,
        Types.AuthoritySignature[] calldata signatures
    ) external whenNotPaused {
        Rule storage rule = rules[ownerDidHash];
        if (rule.status != Types.InheritanceStatus.NONE) revert Errors.InheritanceNotActive();
        if (evidenceHash == bytes32(0)) revert Errors.InvalidBeneficiary();
        if (expiresAt <= block.timestamp) revert Errors.AuthoritySignatureExpired();
        if (signatures.length < AUTHORITY_THRESHOLD) revert Errors.InsufficientAuthoritySignatures();
        if (authoritySetVersion != rule.authoritySetVersion && rule.authoritySetVersion != 0) {
            revert Errors.InvalidBeneficiary();
        }

        bytes32 digest = MessageHashUtils.toTypedDataHash(
            domainSeparator(),
            keccak256(
                abi.encode(
                    _ACTIVATION_TYPEHASH, ownerDidHash, evidenceHash, authoritySetVersion, rule.activationNonce, expiresAt
                )
            )
        );

        address[3] memory seen;
        uint256 validCount = 0;
        for (uint256 i = 0; i < signatures.length; ++i) {
            address authority = signatures[i].authority;
            // A nominee can never activate, regardless of any evidence.
            if (authority == IIdentityRegistry(identityRegistry).controllerOf(rule.defaultNomineeDidHash)) {
                revert Errors.NomineeCannotActivate();
            }
            if (!hasRole(INHERITANCE_AUTHORITY_ROLE, authority)) revert Errors.InvalidPermit();
            for (uint256 j = 0; j < validCount; ++j) {
                if (seen[j] == authority) revert Errors.DuplicateAuthority();
            }
            address recovered = ECDSA.recover(digest, signatures[i].signature);
            if (recovered != authority) revert Errors.InvalidPermit();
            seen[validCount] = authority;
            ++validCount;
        }
        if (validCount < AUTHORITY_THRESHOLD) revert Errors.InsufficientAuthoritySignatures();

        rule.status = Types.InheritanceStatus.ACTIVE;
        rule.authoritySetVersion = authoritySetVersion;
        rule.activationNonce += 1;
        emit InheritanceActivated(ownerDidHash, evidenceHash, authoritySetVersion, rule.activationNonce);
    }

    // ------------------------------------------------------------------
    // Execution
    // ------------------------------------------------------------------
    /// @notice Executes a bounded batch of rule-constrained transfers. Each
    ///         transfer is routed through the restricted AssetRegistry path
    ///         which atomically updates both participant roots.
    /// @param transitions flattened RootTransition list: for each asset, the
    ///        owner transition followed by the beneficiary transition.
    function executeInheritanceBatch(
        bytes32 ownerDidHash,
        uint256[] calldata assetIds,
        bytes32[] calldata beneficiaryDids,
        Types.RootTransition[] calldata transitions
    ) external onlyRole(INHERITANCE_EXECUTOR_ROLE) whenNotPaused {
        Rule storage rule = rules[ownerDidHash];
        if (rule.status != Types.InheritanceStatus.ACTIVE) revert Errors.InheritanceNotActive();
        if (assetIds.length != beneficiaryDids.length) revert Errors.ArrayLengthMismatch();
        if (assetIds.length > MAX_BATCH) revert Errors.BatchTooLarge();
        if (transitions.length != assetIds.length * 2) revert Errors.ArrayLengthMismatch();

        for (uint256 i = 0; i < assetIds.length; ++i) {
            bytes32 beneficiary = beneficiaryDids[i];
            bytes32 overrideBeneficiary = assetOverride[ownerDidHash][assetIds[i]];
            if (
                beneficiary != rule.defaultNomineeDidHash
                    && (overrideBeneficiary == bytes32(0) || beneficiary != overrideBeneficiary)
            ) {
                revert Errors.InvalidBeneficiary();
            }
            if (!IIdentityRegistry(identityRegistry).isActive(beneficiary)) revert Errors.DestinationNotActive();

            Types.RootTransition memory ownerT = transitions[i * 2];
            Types.RootTransition memory beneficiaryT = transitions[i * 2 + 1];
            if (ownerT.didHash != ownerDidHash || beneficiaryT.didHash != beneficiary) {
                revert Errors.ArrayLengthMismatch();
            }
            IAssetRegistryExecutor(assetRegistry).inheritanceTransfer(
                assetIds[i],
                ownerDidHash,
                beneficiary,
                ownerT.oldRoot,
                ownerT.newRoot,
                ownerT.oldVersion,
                beneficiaryT.oldRoot,
                beneficiaryT.newRoot,
                beneficiaryT.oldVersion,
                bytes32(0)
            );
        }
        emit InheritanceBatchExecuted(ownerDidHash, assetIds, beneficiaryDids);
    }

    // ------------------------------------------------------------------
    // Close
    // ------------------------------------------------------------------
    function closeInheritance(bytes32 ownerDidHash) external onlyRole(INHERITANCE_EXECUTOR_ROLE) whenNotPaused {
        Rule storage rule = rules[ownerDidHash];
        if (rule.status != Types.InheritanceStatus.ACTIVE) revert Errors.InheritanceNotActive();
        rule.status = Types.InheritanceStatus.CLOSED;
        emit InheritanceClosed(ownerDidHash);
    }
}

interface IIdentityRegistry {
    function controllerOf(bytes32 didHash) external view returns (address);
    function isActive(bytes32 didHash) external view returns (bool);
}

interface IAssetRegistryExecutor {
    function inheritanceTransfer(
        uint256 assetId,
        bytes32 fromDidHash,
        bytes32 toDidHash,
        bytes32 fromOldRoot,
        bytes32 fromNewRoot,
        uint64 fromRootVersion,
        bytes32 toOldRoot,
        bytes32 toNewRoot,
        uint64 toRootVersion,
        bytes32 operationHash
    ) external;
}

