// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Errors} from "./Errors.sol";
import {Types} from "./Types.sol";

/// @title Base contract for step-up-permit-protected registries.
/// @notice Implements the common EIP-712 permit verifier shared by all
///         registries (blockchain_team_spec.md §3). The EIP-712 domain binds
///         name, version, chain ID, and this contract's address, so permits
///         are non-transferable across chains and contracts. The nonce is
///         consumed strictly before any effect executes (BC-PERMIT-011).
abstract contract Permitted is AccessControl, Pausable {
    bytes32 public constant STEP_UP_ATTESTER_ROLE = keccak256("STEP_UP_ATTESTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256("StepUpPermit(bytes32 operationHash,bytes32 didHash,uint64 expiresAt,uint64 nonce)");

    string internal constant _DOMAIN_NAME = "BlockchainIdentityAssetPlatform";
    string internal constant _DOMAIN_VERSION = "1";

    /// @dev Globally single-use nonces: a consumed nonce can never be reused,
    ///     even across different DIDs (BC-PERMIT-004, INV-10).
    mapping(uint64 => bool) public nonceUsed;

    bytes32 private immutable _domainSeparator;

    constructor() {
        _domainSeparator = keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(_DOMAIN_NAME)),
                keccak256(bytes(_DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
        // Bootstrap: the deployer holds governance until the deployment script
        // transfers DEFAULT_ADMIN_ROLE to the governed multisig.
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function domainSeparator() public view returns (bytes32) {
        return _domainSeparator;
    }

    /// @notice Emergency pause of all write paths; views remain callable.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Verifies and consumes a step-up permit. Must be called before
    ///         any state effect of the protected operation.
    /// @param permit        the attester-signed permit.
    /// @param expectedDidHash the DID the operation is bound to.
    function _verifyPermit(Types.StepUpPermit calldata permit, bytes32 expectedDidHash) internal {
        if (permit.expiresAt <= block.timestamp) revert Errors.InvalidPermit();
        if (permit.didHash != expectedDidHash) revert Errors.InvalidPermit();
        if (nonceUsed[permit.nonce]) revert Errors.InvalidPermit();

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, permit.operationHash, permit.didHash, permit.expiresAt, permit.nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
        address signer = ECDSA.recover(digest, permit.signature);
        if (!hasRole(STEP_UP_ATTESTER_ROLE, signer)) revert Errors.InvalidPermit();

        // Consume nonce strictly before effects (checks-effects-interactions).
        nonceUsed[permit.nonce] = true;
    }
}
