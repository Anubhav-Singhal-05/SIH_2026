// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleRootRegistry} from "../src/MerkleRootRegistry.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {AssetAccessRegistry} from "../src/AssetAccessRegistry.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {InheritanceRegistry} from "../src/InheritanceRegistry.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib, OperationHash} from "../src/Protocol.sol";

/// @title Shared deployment fixture for all test suites.
abstract contract Base is Test {
    MerkleRootRegistry merkle;
    IdentityRegistry identity;
    AssetAccessRegistry access;
    AssetRegistry assets;
    InheritanceRegistry inheritance;

    // Attester/HSM key (signs every step-up permit).
    uint256 constant ATTESTER_KEY = 0xA11CE;
    address ATTESTER = vm.addr(ATTESTER_KEY);

    address constant GOVERNANCE = address(0xA11CE0);
    address constant PAUSER = address(0xB0B00);
    address constant ISSUER = address(0x15500);
    address constant EXECUTOR = address(0xE1000);
    address AUTH1 = vm.addr(0x11111);
    address AUTH2 = vm.addr(0x22222);
    address AUTH3 = vm.addr(0x33333);

    bytes32 internal EMPTY_ROOT_; // precomputed to avoid precompile calls inside vm.expectRevert windows

    // Participant controllers.
    uint256 constant ALICE_KEY = 0xA1CE;
    uint256 constant BOB_KEY = 0xB0B;
    uint256 constant CAROL_KEY = 0xCA20;
    address ALICE = vm.addr(ALICE_KEY);
    address BOB = vm.addr(BOB_KEY);
    address CAROL = vm.addr(CAROL_KEY);

    bytes32 ALICE_DID = keccak256("did:platform:alice");
    bytes32 BOB_DID = keccak256("did:platform:bob");
    bytes32 CAROL_DID = keccak256("did:platform:carol");
    bytes32 NOMINEE_DID = keccak256("did:platform:nominee");

    uint64 constant EXPIRES_AT = type(uint64).max;

    uint64 nonceCounter = 0; // global: nonce space is shared (BC-PERMIT-004)

    function setUp() public virtual {
        EMPTY_ROOT_ = sha256(hex"02"); // == MerkleLib.EMPTY_ROOT(), precomputed once
        // The default Foundry test sender deploys and wires the fixture.
        vm.startPrank(0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38);
        merkle = new MerkleRootRegistry();
        identity = new IdentityRegistry(address(merkle));
        access = new AssetAccessRegistry();
        assets = new AssetRegistry();
        inheritance = new InheritanceRegistry();

        // The test contract plays governance for fixture wiring.
        identity.grantRole(identity.DEFAULT_ADMIN_ROLE(), address(this));
        merkle.grantRole(merkle.DEFAULT_ADMIN_ROLE(), address(this));
        assets.grantRole(assets.DEFAULT_ADMIN_ROLE(), address(this));
        access.grantRole(access.DEFAULT_ADMIN_ROLE(), address(this));
        inheritance.grantRole(inheritance.DEFAULT_ADMIN_ROLE(), address(this));

        merkle.setWriters(address(identity), address(assets));
        access.setWriters(address(identity), address(assets));
        assets.setWriters(address(identity), address(merkle), address(access), address(inheritance));
        inheritance.setWriters(address(identity), address(assets));

        identity.grantRole(identity.STEP_UP_ATTESTER_ROLE(), ATTESTER);
        identity.grantRole(identity.PAUSER_ROLE(), PAUSER);
        identity.grantRole(identity.DEFAULT_ADMIN_ROLE(), GOVERNANCE);
        merkle.grantRole(merkle.STEP_UP_ATTESTER_ROLE(), ATTESTER);
        merkle.grantRole(merkle.PAUSER_ROLE(), PAUSER);
        merkle.grantRole(merkle.DEFAULT_ADMIN_ROLE(), GOVERNANCE);
        assets.grantRole(assets.ASSET_ISSUER_ROLE(), ISSUER);
        assets.grantRole(assets.STEP_UP_ATTESTER_ROLE(), ATTESTER);
        assets.grantRole(assets.PAUSER_ROLE(), PAUSER);
        assets.grantRole(assets.DEFAULT_ADMIN_ROLE(), GOVERNANCE);
        access.grantRole(access.STEP_UP_ATTESTER_ROLE(), ATTESTER);
        access.grantRole(access.PAUSER_ROLE(), PAUSER);
        access.grantRole(access.DEFAULT_ADMIN_ROLE(), GOVERNANCE);
        inheritance.grantRole(inheritance.STEP_UP_ATTESTER_ROLE(), ATTESTER);
        inheritance.grantRole(inheritance.PAUSER_ROLE(), PAUSER);
        inheritance.grantRole(inheritance.DEFAULT_ADMIN_ROLE(), GOVERNANCE);
        inheritance.grantRole(inheritance.INHERITANCE_EXECUTOR_ROLE(), EXECUTOR);
        inheritance.grantRole(inheritance.INHERITANCE_AUTHORITY_ROLE(), AUTH1);
        inheritance.grantRole(inheritance.INHERITANCE_AUTHORITY_ROLE(), AUTH2);
        inheritance.grantRole(inheritance.INHERITANCE_AUTHORITY_ROLE(), AUTH3);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Permit helpers
    // ------------------------------------------------------------------
    function _permitTypeHash() internal pure returns (bytes32) {
        return keccak256("StepUpPermit(bytes32 operationHash,bytes32 didHash,uint64 expiresAt,uint64 nonce)");
    }

    function _digest(bytes32 domain, bytes32 operationHash, bytes32 didHash, uint64 expiresAt, uint64 nonce)
        internal
        pure
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(_permitTypeHash(), operationHash, didHash, expiresAt, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(address target, Types.StepUpPermit memory p) internal view returns (Types.StepUpPermit memory) {
        bytes32 domain;
        if (target == address(identity)) domain = identity.domainSeparator();
        else if (target == address(assets)) domain = assets.domainSeparator();
        else if (target == address(access)) domain = access.domainSeparator();
        else if (target == address(inheritance)) domain = inheritance.domainSeparator();
        else if (target == address(merkle)) domain = merkle.domainSeparator();
        else revert("unknown target");
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(ATTESTER_KEY, _digest(domain, p.operationHash, p.didHash, p.expiresAt, p.nonce));
        p.signature = abi.encodePacked(r, s, v);
        return p;
    }

    function _permit(address target, bytes4 selector, bytes32 didHash, uint64 nonce, bytes memory args)
        internal
        view
        returns (Types.StepUpPermit memory)
    {
        Types.StepUpPermit memory p = Types.StepUpPermit({
            operationHash: OperationHash.compute(target, selector, didHash, nonce, EXPIRES_AT, args),
            didHash: didHash,
            expiresAt: EXPIRES_AT,
            nonce: nonce,
            signature: ""
        });
        return _sign(target, p);
    }

    // ------------------------------------------------------------------
    // Lifecycle helpers
    // ------------------------------------------------------------------
    function _register(bytes32 didHash, address controller, uint64 nonce) internal {
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.registerIdentity.selector,
            didHash,
            nonce,
            abi.encode(didHash, controller, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_)
        );
        vm.prank(controller); // caller must be the controller (BC-PERMIT-006)
        identity.registerIdentity(didHash, controller, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function _registerAlice() internal {
        _register(ALICE_DID, ALICE, ++nonceCounter);
    }

    function _registerBob() internal {
        _register(BOB_DID, BOB, ++nonceCounter);
    }

    function _registerCarol() internal {
        _register(CAROL_DID, CAROL, ++nonceCounter);
    }

    function _mint(uint256 assetId, bytes32 ownerDid, address ownerController, bytes32 oldRoot, uint64 version)
        internal
        returns (bytes32 newRoot)
    {
        bytes32 docHash = keccak256(abi.encode("doc", assetId));
        bytes32 metaHash = keccak256(abi.encode("meta", assetId));
        bytes32 storageCommit = keccak256(abi.encode("storage", assetId));
        bytes32 leaf = MerkleLib.leaf(assetId, ownerDid, docHash, metaHash, 1);
        newRoot = oldRoot == EMPTY_ROOT_ ? leaf : MerkleLib.parent(leaf, oldRoot);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.registerAsset.selector,
            ownerDid,
            ++nonceCounter,
            abi.encode(assetId, ownerDid, docHash, metaHash, storageCommit, oldRoot, newRoot, version)
        );
        vm.startPrank(ISSUER);
        assets.registerAsset(assetId, ownerDid, docHash, metaHash, storageCommit, oldRoot, newRoot, version, p);
        vm.stopPrank();
    }

    function _currentRoot(bytes32 didHash) internal view returns (bytes32 root, uint64 version) {
        (root, version,) = merkle.getCurrentRoot(didHash);
    }
}

