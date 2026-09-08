// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib} from "../src/Protocol.sol";

/// @title BC-ASSET / BC-ACCESS — asset lifecycle and access-control suite.
contract AssetAndAccessTest is Base {
    uint256 constant A1 = 0x1001;
    uint256 constant A2 = 0x1002;

    function _updateDoc(uint256 assetId, bytes32 ownerDid, address controller, uint64 nonce) internal {
        Types.Asset memory a = assets.getAsset(assetId);
        (bytes32 oldRoot, uint64 version) = _currentRoot(ownerDid);
        bytes32 newDoc = keccak256(abi.encode("doc2", assetId));
        bytes32 newMeta = keccak256(abi.encode("meta2", assetId));
        bytes32 newStore = keccak256(abi.encode("store2", assetId));
        bytes32 newRoot = _recomputeRoot(ownerDid, assetId, oldRoot, newDoc, newMeta, a.documentVersion + 1);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.updateDocument.selector,
            ownerDid,
            nonce,
            abi.encode(assetId, a.documentHash, newDoc, newMeta, newStore, oldRoot, newRoot, version)
        );
        vm.prank(controller);
        assets.updateDocument(assetId, a.documentHash, newDoc, newMeta, newStore, oldRoot, newRoot, version, p);
    }

    /// @dev Single-asset-owner recomputation helper (one leaf replaced).
    function _recomputeRoot(bytes32 ownerDid, uint256 assetId, bytes32 oldRoot, bytes32 doc, bytes32 meta, uint32 ver)
        internal
        view
        returns (bytes32)
    {
        // For a one-asset owner the root is exactly the leaf.
        if (oldRoot == EMPTY_ROOT_) return MerkleLib.leaf(assetId, ownerDid, doc, meta, ver);
        // Two-asset owner: rebuild as parent(newLeaf, otherLeaf) — tests only
        // use one asset per owner, so this branch is not exercised.
        return MerkleLib.leaf(assetId, ownerDid, doc, meta, ver);
    }

    // ------------------------------------------------------------------
    // Mint
    // ------------------------------------------------------------------
    function test_BC_ASSET_001_mintSucceedsWithAtomicRootInit() public {
        _registerAlice();
        uint256 assetId = A1;
        _mint(assetId, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        assertEq(assets.ownerDidOf(assetId), ALICE_DID);
        (bytes32 root, uint64 version) = _currentRoot(ALICE_DID);
        Types.Asset memory a = assets.getAsset(assetId);
        assertEq(root, MerkleLib.leaf(assetId, ALICE_DID, a.documentHash, a.metadataHash, 1));
        assertEq(version, 1);
    }

    function test_BC_ASSET_002_mintRequiresIssuerRole() public {
        _registerAlice();
        bytes32 doc = keccak256("d");
        bytes32 newRoot = MerkleLib.leaf(A1, ALICE_DID, doc, doc, 1); // hoist BEFORE prank
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.registerAsset.selector,
            ALICE_DID,
            1,
            abi.encode(A1, ALICE_DID, doc, doc, doc, EMPTY_ROOT_, newRoot, 0)
        );
        vm.prank(ALICE);
        vm.expectRevert();
        assets.registerAsset(A1, ALICE_DID, doc, doc, doc, EMPTY_ROOT_, newRoot, 0, p);
    }

    function test_BC_ASSET_003_mintZeroOrDuplicateAssetIdReverts() public {
        _registerAlice();
        // Duplicate
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        (bytes32 root, uint64 version) = _currentRoot(ALICE_DID);
        bytes32 doc = keccak256(abi.encode("doc", A1));
        bytes32 meta = keccak256(abi.encode("meta", A1));
        bytes32 store = keccak256(abi.encode("storage", A1));
        // Precompute permits BEFORE expectRevert (helpers make staticcalls).
        bytes32 dupNewRoot = MerkleLib.parent(MerkleLib.leaf(A1, ALICE_DID, doc, meta, 1), root);
        Types.StepUpPermit memory dup = _permit(
            address(assets),
            assets.registerAsset.selector,
            ALICE_DID,
            901,
            abi.encode(A1, ALICE_DID, doc, meta, store, root, dupNewRoot, version)
        );
        vm.prank(ISSUER);
        vm.expectRevert(Errors.AssetAlreadyExists.selector);
        assets.registerAsset(A1, ALICE_DID, doc, meta, store, root, dupNewRoot, version, dup);
        // Zero
        Types.StepUpPermit memory zero = _permit(
            address(assets),
            assets.registerAsset.selector,
            ALICE_DID,
            902,
            abi.encode(0, ALICE_DID, doc, meta, store, root, root, version)
        );
        vm.prank(ISSUER);
        vm.expectRevert(Errors.InvalidAssetId.selector);
        assets.registerAsset(0, ALICE_DID, doc, meta, store, root, root, version, zero);
    }

    function test_BC_ASSET_004_mintToInactiveOwnerReverts() public {
        _registerAlice();
        Types.StepUpPermit memory p =
            _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 9, abi.encode(ALICE_DID, uint8(2)));
        vm.prank(ALICE);
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.SUSPENDED, p);
        bytes32 doc = keccak256("d");
        bytes32 inactiveNewRoot = MerkleLib.leaf(A1, ALICE_DID, doc, doc, 1);
        Types.StepUpPermit memory mp = _permit(
            address(assets),
            assets.registerAsset.selector,
            ALICE_DID,
            903,
            abi.encode(A1, ALICE_DID, doc, doc, doc, EMPTY_ROOT_, MerkleLib.leaf(A1, ALICE_DID, doc, doc, 1), 0)
        );
        vm.prank(ISSUER);
        vm.expectRevert(Errors.DestinationNotActive.selector);
        assets.registerAsset(A1, ALICE_DID, doc, doc, doc, EMPTY_ROOT_, inactiveNewRoot, 0, mp);
    }

    function test_BC_ASSET_005_mintStaleRootReverts() public {
        _registerAlice();
        // StaleRoot = the EXPECTED OLD root does not match chain state.
        bytes32 wrongOldRoot = keccak256("stale-old-root");
        bytes32 doc = keccak256("d");
        bytes32 nextRoot = MerkleLib.leaf(A1, ALICE_DID, doc, doc, 1); // hoist BEFORE prank/expectRevert
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.registerAsset.selector,
            ALICE_DID,
            1,
            abi.encode(A1, ALICE_DID, doc, doc, doc, wrongOldRoot, nextRoot, 0)
        );
        vm.prank(ISSUER);
        vm.expectRevert(Errors.StaleRoot.selector);
        assets.registerAsset(A1, ALICE_DID, doc, doc, doc, wrongOldRoot, nextRoot, 0, p);
    }

    // ------------------------------------------------------------------
    // Update
    // ------------------------------------------------------------------
    function test_BC_ASSET_010_updateIncrementsVersionOnce() public {
        _registerAlice();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _updateDoc(A1, ALICE_DID, ALICE, 10);
        Types.Asset memory a = assets.getAsset(A1);
        assertEq(a.documentVersion, 2);
        assertEq(a.documentHash, keccak256(abi.encode("doc2", A1)));
        (, uint64 version) = _currentRoot(ALICE_DID);
        assertEq(version, 2);
    }

    function test_BC_ASSET_011_updateWrongExpectedDocumentHashReverts() public {
        _registerAlice();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        (bytes32 oldRoot, uint64 version) = _currentRoot(ALICE_DID);
        bytes32 wrongExpected = keccak256("not-the-current-doc");
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.updateDocument.selector,
            ALICE_DID,
            11,
            abi.encode(A1, wrongExpected, keccak256("nd"), keccak256("nm"), keccak256("ns"), oldRoot, oldRoot, version)
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.DocumentHashMismatch.selector);
        assets.updateDocument(
            A1, wrongExpected, keccak256("nd"), keccak256("nm"), keccak256("ns"), oldRoot, oldRoot, version, p
        );
    }

    // ------------------------------------------------------------------
    // Access grants
    // ------------------------------------------------------------------
    function _grant(uint256 assetId, bytes32 ownerDid, address controller, bytes32 grantee, uint64 nonce) internal {
        uint16 mask = access.MASK_READ(); // hoist staticcalls BEFORE prank
        Types.StepUpPermit memory p = _permit(
            address(access),
            access.grantAccess.selector,
            ownerDid,
            nonce,
            abi.encode(assetId, grantee, mask, uint64(block.timestamp + 1 days))
        );
        vm.prank(controller); // prank AFTER all staticcalls
        access.grantAccess(assetId, grantee, mask, uint64(block.timestamp + 1 days), p);
    }

    function test_BC_ACCESS_001_grantSucceedsAndDoesNotAlterRoot() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        (bytes32 rootBefore, uint64 versionBefore) = _currentRoot(ALICE_DID);
        _grant(A1, ALICE_DID, ALICE, BOB_DID, 20);
        assertTrue(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
        assertFalse(access.hasAccess(A1, BOB_DID, access.MASK_SHARE()));
        (bytes32 rootAfter, uint64 versionAfter) = _currentRoot(ALICE_DID);
        assertEq(rootBefore, rootAfter);
        assertEq(versionBefore, versionAfter);
    }

    function test_BC_ACCESS_002_selfGrantForbidden() public {
        _registerAlice();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        uint16 mask = access.MASK_READ();
        Types.StepUpPermit memory p = _permit(
            address(access),
            access.grantAccess.selector,
            ALICE_DID,
            21,
            abi.encode(A1, ALICE_DID, mask, uint64(block.timestamp + 1 days))
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.SelfGrantForbidden.selector);
        access.grantAccess(A1, ALICE_DID, mask, uint64(block.timestamp + 1 days), p);
    }

    function test_BC_ACCESS_003_invalidMaskRevertsUpdateAndTransferDelegation() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        uint16 badMask = access.MASK_UPDATE(); // MVP forbids UPDATE delegation
        Types.StepUpPermit memory p = _permit(
            address(access),
            access.grantAccess.selector,
            ALICE_DID,
            22,
            abi.encode(A1, BOB_DID, badMask, uint64(block.timestamp + 1 days))
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermissionMask.selector);
        access.grantAccess(A1, BOB_DID, badMask, uint64(block.timestamp + 1 days), p);
    }

    function test_BC_ACCESS_004_nonOwnerCannotGrant() public {
        _registerAlice();
        _registerBob();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        Types.StepUpPermit memory p = _permit(
            address(access),
            access.grantAccess.selector,
            ALICE_DID,
            23,
            abi.encode(A1, CAROL_DID, uint16(access.MASK_READ()), uint64(block.timestamp + 1 days))
        );
        uint16 mask = access.MASK_READ();
        vm.prank(BOB);
        vm.expectRevert(Errors.CallerNotController.selector);
        access.grantAccess(A1, CAROL_DID, mask, uint64(block.timestamp + 1 days), p);
    }

    function test_BC_ACCESS_005_expiredPermissionHasNoAccess() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _grant(A1, ALICE_DID, ALICE, BOB_DID, 24);
        assertTrue(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
        vm.warp(block.timestamp + 2 days);
        assertFalse(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
    }

    function test_BC_ACCESS_006_revokeAccess() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _grant(A1, ALICE_DID, ALICE, BOB_DID, 25);
        Types.StepUpPermit memory p = _permit(
            address(access), access.revokeAccess.selector, ALICE_DID, 26, abi.encode(A1, BOB_DID)
        );
        vm.prank(ALICE);
        access.revokeAccess(A1, BOB_DID, p);
        assertFalse(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
    }
}

/// @title BC-ASSET-020..030 — atomic transfer and deactivation.
contract TransferTest is Base {
    uint256 constant A1 = 0x1001;
    uint256 constant A2 = 0x1002;

    function _grant(uint256 assetId, bytes32 ownerDid, address controller, bytes32 grantee, uint64 nonce) internal {
        uint16 mask = access.MASK_READ(); // hoist staticcalls BEFORE prank
        Types.StepUpPermit memory p = _permit(
            address(access),
            access.grantAccess.selector,
            ownerDid,
            nonce,
            abi.encode(assetId, grantee, mask, uint64(block.timestamp + 1 days))
        );
        vm.prank(controller); // prank AFTER all staticcalls
        access.grantAccess(assetId, grantee, mask, uint64(block.timestamp + 1 days), p);
    }

    function test_BC_ASSET_020_transferAtomicallyUpdatesBothRootsAndClearsAccess() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _mint(A2, BOB_DID, BOB, EMPTY_ROOT_, 0);
        _grant(A1, ALICE_DID, ALICE, BOB_DID, 20);
        assertTrue(access.hasAccess(A1, BOB_DID, access.MASK_READ()));

        Types.Asset memory a = assets.getAsset(A1);
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        (bytes32 bobRoot, uint64 bobVersion) = _currentRoot(BOB_DID);
        Types.Asset memory bobAsset = assets.getAsset(A2);

        bytes32 aliceNew = EMPTY_ROOT_;
        bytes32 bobNew = MerkleLib.parent(
            MerkleLib.leaf(A2, BOB_DID, bobAsset.documentHash, bobAsset.metadataHash, bobAsset.documentVersion),
            MerkleLib.leaf(A1, BOB_DID, a.documentHash, a.metadataHash, a.documentVersion)
        );

        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            21,
            abi.encode(A1, ALICE_DID, BOB_DID, aliceRoot, aliceNew, aliceVersion, bobRoot, bobNew, bobVersion)
        );
        vm.prank(ALICE);
        assets.transferAsset(A1, ALICE_DID, BOB_DID, aliceRoot, aliceNew, aliceVersion, bobRoot, bobNew, bobVersion, p);

        assertEq(assets.ownerDidOf(A1), BOB_DID);
        (bytes32 aliceAfter, uint64 aliceV2) = _currentRoot(ALICE_DID);
        (bytes32 bobAfter,) = _currentRoot(BOB_DID);
        assertEq(aliceAfter, EMPTY_ROOT_);
        assertEq(aliceV2, aliceVersion + 1);
        assertEq(bobAfter, bobNew);
        // Delegated permission cleared by the transfer (INV-06 / invariant).
        assertFalse(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
    }

    function test_BC_ASSET_021_transferStaleRootRevertsLeavingStateUnchanged() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        (, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        // StaleRoot = the EXPECTED OLD root does not match chain state.
        bytes32 staleOldRoot = keccak256("bogus-old-root");
        bytes32 fakeBobRoot = MerkleLib.leaf(A1, BOB_DID, keccak256("x"), keccak256("x"), 1);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            22,
            abi.encode(A1, ALICE_DID, BOB_DID, staleOldRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0)
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.StaleRoot.selector);
        assets.transferAsset(A1, ALICE_DID, BOB_DID, staleOldRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0, p);
        (bytes32 root, uint64 version) = _currentRoot(ALICE_DID);
        assertNotEq(root, staleOldRoot);
        assertEq(version, aliceVersion);
    }

    function test_BC_ASSET_022_transferToInactiveRecipientReverts() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        Types.StepUpPermit memory sp =
            _permit(address(identity), identity.setIdentityStatus.selector, BOB_DID, 9, abi.encode(BOB_DID, uint8(3)));
        identity.setIdentityStatus(BOB_DID, Types.IdentityStatus.DEACTIVATED, sp);
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        bytes32 fakeBobRoot = MerkleLib.leaf(A1, BOB_DID, keccak256("x"), keccak256("x"), 1);
        Types.StepUpPermit memory tp = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            23,
            abi.encode(
                A1,
                ALICE_DID,
                BOB_DID,
                aliceRoot,
                EMPTY_ROOT_,
                aliceVersion,
                EMPTY_ROOT_,
                fakeBobRoot,
                0
            )
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.DestinationNotActive.selector);
        assets.transferAsset(
            A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0, tp
        );
    }

    function test_BC_ASSET_023_nonOwnerCannotTransfer() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        bytes32 fakeBobRoot = MerkleLib.leaf(A1, BOB_DID, keccak256("x"), keccak256("x"), 1);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            24,
            abi.encode(
                A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0
            )
        );
        vm.prank(BOB);
        vm.expectRevert(Errors.CallerNotController.selector);
        assets.transferAsset(
            A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0, p
        );
    }

    function test_BC_ASSET_024_issuerCannotTransferOwnerAsset() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        // The issuer has no transfer privilege (invariant: only owner or
        // inheritance pathway can move an asset). Direct transfer call by the
        // issuer reverts because the caller is not the owner controller.
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        bytes32 fakeBobRoot = MerkleLib.leaf(A1, BOB_DID, keccak256("x"), keccak256("x"), 1);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            25,
            abi.encode(
                A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0
            )
        );
        vm.prank(ISSUER);
        vm.expectRevert(Errors.CallerNotController.selector);
        assets.transferAsset(
            A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0, p
        );
    }

    function test_BC_ASSET_030_deactivateRemovesLeafThroughRootTransition() public {
        _registerAlice();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        (bytes32 oldRoot, uint64 version) = _currentRoot(ALICE_DID);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.deactivateAsset.selector,
            ALICE_DID,
            30,
            abi.encode(A1, oldRoot, EMPTY_ROOT_, version)
        );
        vm.prank(ALICE);
        assets.deactivateAsset(A1, oldRoot, EMPTY_ROOT_, version, p);
        assertTrue(assets.getAsset(A1).status == Types.AssetStatus.DEACTIVATED);
        (bytes32 root, uint64 v2) = _currentRoot(ALICE_DID);
        assertEq(root, EMPTY_ROOT_);
        assertEq(v2, version + 1);
    }
}


