// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Permitted} from "./Permitted.sol";
import {Errors} from "./Errors.sol";
import {Types} from "./Types.sol";

/// @title Asset-level access and platform-role registry.
/// @notice Permission bitmask: READ 1, UPDATE 2, TRANSFER 4, SHARE 8, VERIFY 16.
///         MVP allows READ, SHARE, VERIFY only; UPDATE/TRANSFER delegation is
///         rejected until the feature flag and review (spec §4).
///         Only the AssetRegistry may clear all permissions after a transfer.
contract AssetAccessRegistry is Permitted {
    event PlatformRoleGranted(bytes32 indexed didHash, uint8 indexed platformRole, uint64 expiresAt);
    event PlatformRoleRevoked(bytes32 indexed didHash, uint8 indexed platformRole);
    event AccessGranted(uint256 indexed assetId, bytes32 indexed granteeDidHash, uint16 mask, uint64 expiresAt);
    event AccessRevoked(uint256 indexed assetId, bytes32 indexed granteeDidHash);
    event AccessClearedOnTransfer(uint256 indexed assetId, uint256 clearedCount);

    uint16 public constant MASK_READ = 1;
    uint16 public constant MASK_UPDATE = 2;
    uint16 public constant MASK_TRANSFER = 4;
    uint16 public constant MASK_SHARE = 8;
    uint16 public constant MASK_VERIFY = 16;

    uint8 public constant PLATFORM_ROLE_ADMIN = 1;
    uint8 public constant PLATFORM_ROLE_MANAGER = 2;
    uint8 public constant PLATFORM_ROLE_AUDITOR = 3;
    uint8 public constant PLATFORM_ROLE_USER = 4;

    uint16 private constant _MVP_ALLOWED_MASK = MASK_READ | MASK_SHARE | MASK_VERIFY;

    struct PlatformRole {
        uint8 role;
        bool active;
        uint64 expiresAt;
    }

    mapping(bytes32 => PlatformRole) public platformRoles;

    mapping(uint256 => mapping(bytes32 => Types.Permission)) private _permissions;
    mapping(uint256 => bytes32[]) private _activeGrantees;
    mapping(uint256 => mapping(bytes32 => uint256)) private _granteeIndex;

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
    // Platform roles
    // ------------------------------------------------------------------
    function grantPlatformRole(
        bytes32 didHash,
        uint8 platformRole,
        uint64 expiresAt,
        Types.StepUpPermit calldata permit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        if (!IIdentityRegistry(identityRegistry).isActive(didHash)) revert Errors.IdentityNotActive();
        if (expiresAt <= block.timestamp) revert Errors.PermissionExpired();
        _verifyPermit(permit, didHash);
        platformRoles[didHash] = PlatformRole({role: platformRole, active: true, expiresAt: expiresAt});
        emit PlatformRoleGranted(didHash, platformRole, expiresAt);
    }

    function revokePlatformRole(bytes32 didHash, Types.StepUpPermit calldata permit)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNotPaused
    {
        _verifyPermit(permit, didHash);
        delete platformRoles[didHash];
        emit PlatformRoleRevoked(didHash, 0);
    }

    // ------------------------------------------------------------------
    // Asset access
    // ------------------------------------------------------------------
    /// @notice Grants `mask` on `assetId` to an active grantee DID. Requires
    ///         the current owner's controller plus a valid permit.
    function grantAccess(
        uint256 assetId,
        bytes32 granteeDidHash,
        uint16 mask,
        uint64 expiresAt,
        Types.StepUpPermit calldata permit
    ) external whenNotPaused {
        bytes32 ownerDid = IAssetRegistryView(assetRegistry).ownerDidOf(assetId);
        if (IAssetRegistryView(assetRegistry).getAsset(assetId).status != Types.AssetStatus.ACTIVE) revert Errors.AssetInactive();
        address controller = IIdentityRegistry(identityRegistry).controllerOf(ownerDid);
        _verifyPermit(permit, ownerDid);
        if (msg.sender != controller) revert Errors.CallerNotController();

        if (granteeDidHash == ownerDid) revert Errors.SelfGrantForbidden();
        if (!IIdentityRegistry(identityRegistry).isActive(granteeDidHash)) revert Errors.DestinationNotActive();
        if (mask == 0 || (mask & ~_MVP_ALLOWED_MASK) != 0) revert Errors.InvalidPermissionMask();
        if (expiresAt <= block.timestamp) revert Errors.PermissionExpired();

        Types.Permission storage p = _permissions[assetId][granteeDidHash];
        if (!p.active) {
            _granteeIndex[assetId][granteeDidHash] = _activeGrantees[assetId].length;
            _activeGrantees[assetId].push(granteeDidHash);
        }
        _permissions[assetId][granteeDidHash] =
            Types.Permission({mask: mask, expiresAt: expiresAt, active: true, updatedAt: uint64(block.timestamp)});
        emit AccessGranted(assetId, granteeDidHash, mask, expiresAt);
    }

    function revokeAccess(uint256 assetId, bytes32 granteeDidHash, Types.StepUpPermit calldata permit)
        external
        whenNotPaused
    {
        bytes32 ownerDid = IAssetRegistryView(assetRegistry).ownerDidOf(assetId);
        address controller = IIdentityRegistry(identityRegistry).controllerOf(ownerDid);
        _verifyPermit(permit, ownerDid);
        if (msg.sender != controller) revert Errors.CallerNotController();

        Types.Permission storage p = _permissions[assetId][granteeDidHash];
        if (!p.active) revert Errors.NotAuthorized();
        p.active = false;
        p.updatedAt = uint64(block.timestamp);
        _removeActiveGrantee(assetId, granteeDidHash);
        emit AccessRevoked(assetId, granteeDidHash);
    }

    /// @notice True when an active, unexpired permission covering all bits of
    ///         `mask` exists. Owner has implied control and needs no self-grant.
    function hasAccess(uint256 assetId, bytes32 granteeDidHash, uint16 mask) external view returns (bool) {
        Types.Permission memory p = _permissions[assetId][granteeDidHash];
        return p.active && p.mask & mask == mask && p.expiresAt > block.timestamp;
    }

    function getPermission(uint256 assetId, bytes32 granteeDidHash)
        external
        view
        returns (Types.Permission memory)
    {
        return _permissions[assetId][granteeDidHash];
    }

    /// @notice Clears every delegated permission on an asset. Only the
    ///         AssetRegistry calls this as part of an atomic transfer.
    /// @dev Bounded per-asset grantee list, not a portfolio-wide sweep.
    function revokeAllForTransfer(uint256 assetId) external whenNotPaused {
        if (msg.sender != assetRegistry) revert Errors.NotAuthorized();
        bytes32[] storage grantees = _activeGrantees[assetId];
        uint256 count = grantees.length;
        for (uint256 i = 0; i < count; ++i) {
            bytes32 grantee = grantees[i];
            _permissions[assetId][grantee].active = false;
            _granteeIndex[assetId][grantee] = 0;
            emit AccessRevoked(assetId, grantee);
        }
        delete _activeGrantees[assetId];
        emit AccessClearedOnTransfer(assetId, count);
    }

    function _removeActiveGrantee(uint256 assetId, bytes32 granteeDidHash) private {
        bytes32[] storage grantees = _activeGrantees[assetId];
        uint256 idx = _granteeIndex[assetId][granteeDidHash];
        uint256 last = grantees.length - 1;
        if (idx != last) {
            bytes32 moved = grantees[last];
            grantees[idx] = moved;
            _granteeIndex[assetId][moved] = idx;
        }
        grantees.pop();
        delete _granteeIndex[assetId][granteeDidHash];
    }
}

interface IIdentityRegistry {
    function controllerOf(bytes32 didHash) external view returns (address);
    function isActive(bytes32 didHash) external view returns (bool);
}

interface IAssetRegistryView {
    function ownerDidOf(uint256 assetId) external view returns (bytes32);
    function getAsset(uint256 assetId) external view returns (Types.Asset memory);
}

