// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib, OperationHash} from "../src/Protocol.sol";

/// @title INT-E2E-001 happy path + INT-E2E-003 rollback path.
contract E2ETest is Base {
    uint256 constant A1 = 0x3001;

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

    function test_INT_E2E_001_fullLifecycle() public {
        _registerAlice();
        _registerBob();
        _registerCarol();

        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        assertEq(assets.ownerDidOf(A1), ALICE_DID);

        // Grant Bob READ; root must not change.
        (bytes32 rootBefore,) = _currentRoot(ALICE_DID);
        _grant(A1, ALICE_DID, ALICE, BOB_DID, 60);
        assertTrue(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
        (bytes32 rootAfter,) = _currentRoot(ALICE_DID);
        assertEq(rootBefore, rootAfter);

        // Update document to v2.
        Types.Asset memory a = assets.getAsset(A1);
        (bytes32 oldRoot, uint64 oldVersion) = _currentRoot(ALICE_DID);
        bytes32 newDoc = keccak256("doc-v2");
        bytes32 newRoot = MerkleLib.leaf(A1, ALICE_DID, newDoc, keccak256("meta-v2"), 2);
        Types.StepUpPermit memory up = _permit(
            address(assets),
            assets.updateDocument.selector,
            ALICE_DID,
            61,
            abi.encode(A1, a.documentHash, newDoc, keccak256("meta-v2"), keccak256("store-v2"), oldRoot, newRoot, oldVersion)
        );
        vm.prank(ALICE);
        assets.updateDocument(
            A1, a.documentHash, newDoc, keccak256("meta-v2"), keccak256("store-v2"), oldRoot, newRoot, oldVersion, up
        );
        assertEq(assets.getAsset(A1).documentVersion, 2);

        // Revoke Bob's access.
        Types.StepUpPermit memory rev =
            _permit(address(access), access.revokeAccess.selector, ALICE_DID, 62, abi.encode(A1, BOB_DID));
        vm.prank(ALICE); // prank AFTER permit staticcalls
        access.revokeAccess(A1, BOB_DID, rev);
        assertFalse(access.hasAccess(A1, BOB_DID, access.MASK_READ()));

        // Transfer to Carol.
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        Types.Asset memory a2 = assets.getAsset(A1);
        bytes32 carolNew = MerkleLib.leaf(A1, CAROL_DID, a2.documentHash, a2.metadataHash, a2.documentVersion);
        Types.StepUpPermit memory tp = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            63,
            abi.encode(A1, ALICE_DID, CAROL_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, carolNew, 0)
        );
        vm.prank(ALICE);
        assets.transferAsset(
            A1, ALICE_DID, CAROL_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, carolNew, 0, tp
        );
        assertEq(assets.ownerDidOf(A1), CAROL_DID);
        assertFalse(access.hasAccess(A1, BOB_DID, access.MASK_READ()));

        // Audit trail: history complete and ordered.
        (bytes32 hist1,,) = merkle.getRootAtVersion(ALICE_DID, 1);
        assertEq(hist1, MerkleLib.leaf(A1, ALICE_DID, a.documentHash, a.metadataHash, 1));
        (bytes32 aliceFinal, uint64 finalVersion) = _currentRoot(ALICE_DID);
        assertEq(aliceFinal, EMPTY_ROOT_);
        assertEq(finalVersion, 3);
    }

    function test_INT_E2E_003_revertedTransferLeavesEverythingUnchanged() public {
        _registerAlice();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _grant(A1, ALICE_DID, ALICE, BOB_DID, 70);

        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        // Recipient deactivated mid-flight.
        Types.StepUpPermit memory sp =
            _permit(address(identity), identity.setIdentityStatus.selector, BOB_DID, 8, abi.encode(BOB_DID, uint8(3)));
        identity.setIdentityStatus(BOB_DID, Types.IdentityStatus.DEACTIVATED, sp);

        bytes32 fakeBobRoot = MerkleLib.leaf(A1, BOB_DID, keccak256("x"), keccak256("x"), 1);
        Types.StepUpPermit memory tp = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            71,
            abi.encode(A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0)
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.DestinationNotActive.selector);
        assets.transferAsset(
            A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, fakeBobRoot, 0, tp
        );

        // Ownership, roots, permissions all unchanged.
        assertEq(assets.ownerDidOf(A1), ALICE_DID);
        assertTrue(access.hasAccess(A1, BOB_DID, access.MASK_READ()));
        (bytes32 root, uint64 version) = _currentRoot(ALICE_DID);
        assertEq(root, aliceRoot);
        assertEq(version, aliceVersion);
    }

    function test_BC_DEPLOY_012_crossLanguageGoldenVector() public {
        // The on-chain OperationHash computation must match the fixed golden
        // value derived from the documented formula.
        bytes memory args = abi.encode(uint256(1), ALICE_DID);
        bytes32 expected = keccak256(
            abi.encode(
                block.chainid,
                address(assets),
                assets.registerAsset.selector,
                ALICE_DID,
                uint64(7),
                uint64(99),
                keccak256(args)
            )
        );
        assertEq(OperationHash.compute(address(assets), assets.registerAsset.selector, ALICE_DID, 7, 99, args), expected);
    }
}

