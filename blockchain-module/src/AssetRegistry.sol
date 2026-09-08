// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Permitted} from "./Permitted.sol";
import {Errors} from "./Errors.sol";
import {Types} from "./Types.sol";

/// @title DID-native unique asset registry with atomic root transitions.
/// @notice Every lifecycle operation (mint, update, transfer, deactivate)
///         validates the exact old root/version of every affected DID and
///         transitions roots atomically with asset state (spec §4, §5).
///         Generic ERC-721 approval/transfer entrypoints are deliberately
///         absent so external token logic cannot bypass root and step-up
///         requirements.
contract AssetRegistry is Permitted {
    event AssetRegistered(
        uint256 indexed assetId,
        bytes32 indexed ownerDidHash,
        bytes32 documentHash,
        bytes32 metadataHash,
        bytes32 storageRefCommitment,
        uint32 documentVersion
    );
    event DocumentVersionUpdated(
        uint256 indexed assetId,
        bytes32 oldDocumentHash,
        bytes32 newDocumentHash,
        bytes32 newMetadataHash,
        bytes32 newStorageCommitment,
        uint32 newDocumentVersion
    );
    event AssetTransferred(uint256 indexed assetId, bytes32 indexed fromDidHash, bytes32 indexed toDidHash);
    event AssetDeactivated(uint256 indexed assetId, bytes32 indexed ownerDidHash);

    bytes32 public constant ASSET_ISSUER_ROLE = keccak256("ASSET_ISSUER_ROLE");

    mapping(uint256 => Types.Asset) private _assets;

    address public identityRegistry;
    address public merkleRootRegistry;
    address public assetAccessRegistry;
    address public inheritanceRegistry;

    /// @notice Wired once by governance/deployer after all registries exist.
    function setWriters(
        address identityRegistry_,
        address merkleRootRegistry_,
        address assetAccessRegistry_,
        address inheritanceRegistry_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            identityRegistry == address(0) && merkleRootRegistry == address(0)
                && assetAccessRegistry == address(0) && inheritanceRegistry == address(0),
            "writers already set"
        );
        require(
            identityRegistry_ != address(0) && merkleRootRegistry_ != address(0) && assetAccessRegistry_ != address(0)
                && inheritanceRegistry_ != address(0),
            "zero writer"
        );
        identityRegistry = identityRegistry_;
        merkleRootRegistry = merkleRootRegistry_;
        assetAccessRegistry = assetAccessRegistry_;
        inheritanceRegistry = inheritanceRegistry_;
    }

    // ------------------------------------------------------------------
    // Mint
    // ------------------------------------------------------------------
    function registerAsset(
        uint256 assetId,
        bytes32 ownerDidHash,
        bytes32 documentHash,
        bytes32 metadataHash,
        bytes32 storageRefCommitment,
        bytes32 oldRoot,
        bytes32 newRoot,
        uint64 rootVersion,
        Types.StepUpPermit calldata permit
    ) external onlyRole(ASSET_ISSUER_ROLE) whenNotPaused {
        if (assetId == 0 || assetId > type(uint128).max) revert Errors.InvalidAssetId();
        if (_assets[assetId].status != Types.AssetStatus.NONE) revert Errors.AssetAlreadyExists();
        if (!IIdentityRegistry(identityRegistry).isActive(ownerDidHash)) revert Errors.DestinationNotActive();
        _verifyPermit(permit, ownerDidHash);
        // The register caller needs the ASSET_ISSUER role and an issuer-bound
        // permit; issuance confers no later transfer privilege.

        // Validate exact old root/version, then transition atomically.
        IMerkleRootWriter(merkleRootRegistry).transitionRoot(ownerDidHash, oldRoot, rootVersion, newRoot, permit.operationHash);

        _assets[assetId] = Types.Asset({
            ownerDid: ownerDidHash,
            documentHash: documentHash,
            metadataHash: metadataHash,
            storageRefCommitment: storageRefCommitment,
            documentVersion: 1,
            status: Types.AssetStatus.ACTIVE
        });
        emit AssetRegistered(assetId, ownerDidHash, documentHash, metadataHash, storageRefCommitment, 1);
    }

    // ------------------------------------------------------------------
    // Document update (immutable new version)
    // ------------------------------------------------------------------
    function updateDocument(
        uint256 assetId,
        bytes32 expectedDocumentHash,
        bytes32 newDocumentHash,
        bytes32 newMetadataHash,
        bytes32 newStorageCommitment,
        bytes32 oldRoot,
        bytes32 newRoot,
        uint64 rootVersion,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        Types.Asset storage asset = _assets[assetId];
        if (asset.status == Types.AssetStatus.NONE) revert Errors.UnknownAsset();
        if (asset.status != Types.AssetStatus.ACTIVE) revert Errors.AssetInactive();
        if (asset.documentHash != expectedDocumentHash) revert Errors.DocumentHashMismatch();
        _verifyPermit(permit, asset.ownerDid);
        if (msg.sender != IIdentityRegistry(identityRegistry).controllerOf(asset.ownerDid)) revert Errors.CallerNotController();

        IMerkleRootWriter(merkleRootRegistry).transitionRoot(asset.ownerDid, oldRoot, rootVersion, newRoot, permit.operationHash);

        asset.documentHash = newDocumentHash;
        asset.metadataHash = newMetadataHash;
        asset.storageRefCommitment = newStorageCommitment;
        // Document version increments exactly once per update.
        asset.documentVersion += 1;
        emit DocumentVersionUpdated(
            assetId, expectedDocumentHash, newDocumentHash, newMetadataHash, newStorageCommitment, asset.documentVersion
        );
    }

    // ------------------------------------------------------------------
    // Transfer (atomic: permission clear + both root transitions)
    // ------------------------------------------------------------------
    function transferAsset(
        uint256 assetId,
        bytes32 fromDidHash,
        bytes32 toDidHash,
        bytes32 fromOldRoot,
        bytes32 fromNewRoot,
        uint64 fromRootVersion,
        bytes32 toOldRoot,
        bytes32 toNewRoot,
        uint64 toRootVersion,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        _verifyPermit(permit, fromDidHash);
        _transfer(
            assetId,
            fromDidHash,
            toDidHash,
            fromOldRoot,
            fromNewRoot,
            fromRootVersion,
            toOldRoot,
            toNewRoot,
            toRootVersion,
            permit.operationHash,
            msg.sender
        );
    }

    // ------------------------------------------------------------------
    // Deactivation
    // ------------------------------------------------------------------
    function deactivateAsset(
        uint256 assetId,
        bytes32 oldRoot,
        bytes32 newRoot,
        uint64 rootVersion,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        Types.Asset storage asset = _assets[assetId];
        if (asset.status == Types.AssetStatus.NONE) revert Errors.UnknownAsset();
        if (asset.status != Types.AssetStatus.ACTIVE) revert Errors.AssetInactive();
        _verifyPermit(permit, asset.ownerDid);
        if (msg.sender != IIdentityRegistry(identityRegistry).controllerOf(asset.ownerDid)) revert Errors.CallerNotController();

        IMerkleRootWriter(merkleRootRegistry).transitionRoot(asset.ownerDid, oldRoot, rootVersion, newRoot, permit.operationHash);

        asset.status = Types.AssetStatus.DEACTIVATED;
        emit AssetDeactivated(assetId, asset.ownerDid);
    }

    // ------------------------------------------------------------------
    // Restricted inheritance transfer path
    // ------------------------------------------------------------------
    /// @notice Only the InheritanceRegistry may call this, for an activated
    ///         rule-constrained batch. Updates owner and beneficiary roots
    ///         atomically with ownership and permission state.
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
    ) external whenNotPaused {
        if (msg.sender != inheritanceRegistry) revert Errors.NotInheritanceExecutor();
        _transfer(
            assetId,
            fromDidHash,
            toDidHash,
            fromOldRoot,
            fromNewRoot,
            fromRootVersion,
            toOldRoot,
            toNewRoot,
            toRootVersion,
            operationHash,
            inheritanceRegistry
        );
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function ownerDidOf(uint256 assetId) external view returns (bytes32) {
        Types.Asset storage asset = _assets[assetId];
        if (asset.status == Types.AssetStatus.NONE) revert Errors.UnknownAsset();
        // Resolved dynamically: controller rotation requires no asset sweep.
        return asset.ownerDid;
    }

    function getAsset(uint256 assetId) external view returns (Types.Asset memory) {
        Types.Asset memory asset = _assets[assetId];
        if (asset.status == Types.AssetStatus.NONE) revert Errors.UnknownAsset();
        return asset;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------
    function _transfer(
        uint256 assetId,
        bytes32 fromDidHash,
        bytes32 toDidHash,
        bytes32 fromOldRoot,
        bytes32 fromNewRoot,
        uint64 fromRootVersion,
        bytes32 toOldRoot,
        bytes32 toNewRoot,
        uint64 toRootVersion,
        bytes32 operationHash,
        address expectedCaller
    ) private {
        Types.Asset storage asset = _assets[assetId];
        if (asset.status == Types.AssetStatus.NONE) revert Errors.UnknownAsset();
        if (asset.status != Types.AssetStatus.ACTIVE) revert Errors.AssetInactive();
        if (asset.ownerDid != fromDidHash) revert Errors.NotAssetOwner();
        if (fromDidHash == toDidHash) revert Errors.InvalidTransfer();
        if (!IIdentityRegistry(identityRegistry).isActive(toDidHash)) revert Errors.DestinationNotActive();
        if (expectedCaller != inheritanceRegistry && msg.sender != IIdentityRegistry(identityRegistry).controllerOf(fromDidHash)) {
            revert Errors.CallerNotController();
        }

        // Validate both old roots/versions, update state, then transition
        // both roots; any failure reverts the entire operation.
        IMerkleRootWriter(merkleRootRegistry).transitionRoot(fromDidHash, fromOldRoot, fromRootVersion, fromNewRoot, operationHash);
        IAssetAccessWriter(assetAccessRegistry).revokeAllForTransfer(assetId);
        asset.ownerDid = toDidHash;
        IMerkleRootWriter(merkleRootRegistry).transitionRoot(toDidHash, toOldRoot, toRootVersion, toNewRoot, operationHash);

        emit AssetTransferred(assetId, fromDidHash, toDidHash);
    }
}

interface IIdentityRegistry {
    function controllerOf(bytes32 didHash) external view returns (address);
    function isActive(bytes32 didHash) external view returns (bool);
}

interface IMerkleRootWriter {
    function transitionRoot(
        bytes32 didHash,
        bytes32 expectedOldRoot,
        uint64 expectedOldVersion,
        bytes32 newRoot,
        bytes32 operationHash
    ) external;
}

interface IAssetAccessWriter {
    function revokeAllForTransfer(uint256 assetId) external;
}

