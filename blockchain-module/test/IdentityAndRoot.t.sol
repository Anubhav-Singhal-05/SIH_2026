// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib} from "../src/Protocol.sol";

/// @title BC-IDENT-001..019 — identity registry suite.
contract IdentityTest is Base {
    function test_BC_IDENT_001_registerSucceedsAndIsActive() public {
        _registerAlice();
        assertTrue(identity.isActive(ALICE_DID));
        assertEq(identity.controllerOf(ALICE_DID), ALICE);
    }

    function test_BC_IDENT_002_registerInitializesEmptyRootVersion0() public {
        _registerAlice();
        (bytes32 root, uint64 version,) = merkle.getCurrentRoot(ALICE_DID);
        assertEq(root, EMPTY_ROOT_);
        assertEq(version, 0);
    }

    function test_BC_IDENT_003_duplicateDidReverts() public {
        _registerAlice();
        // Precompute the permit BEFORE expectRevert (staticcalls would consume it).
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.registerIdentity.selector,
            ALICE_DID,
            99,
            abi.encode(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_)
        );
        vm.prank(ALICE);
        vm.expectRevert(Errors.IdentityExists.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function test_BC_IDENT_004_zeroControllerReverts() public {
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.registerIdentity.selector,
            ALICE_DID,
            1,
            abi.encode(ALICE_DID, address(0), keccak256("k"), keccak256("r"), EMPTY_ROOT_)
        );
        vm.expectRevert(Errors.InvalidController.selector);
        identity.registerIdentity(ALICE_DID, address(0), keccak256("k"), keccak256("r"), EMPTY_ROOT_, p);
    }

    function test_BC_IDENT_007_rotateController() public {
        _registerAlice();
        address newController = makeAddr("newController");
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.rotateController.selector,
            ALICE_DID,
            3,
            abi.encode(ALICE_DID, newController, keccak256("newkey"))
        );
        vm.prank(ALICE);
        identity.rotateController(ALICE_DID, newController, keccak256("newkey"), p);
        assertEq(identity.controllerOf(ALICE_DID), newController);
    }

    function test_BC_IDENT_008_rotateControllerUnknownDidReverts() public {
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.rotateController.selector,
            ALICE_DID,
            3,
            abi.encode(ALICE_DID, BOB, keccak256("newkey"))
        );
        vm.expectRevert(Errors.UnknownIdentity.selector);
        vm.prank(ALICE);
        identity.rotateController(ALICE_DID, BOB, keccak256("newkey"), p);
    }

    function test_BC_IDENT_010_controllerRotationDoesNotTouchAssets() public {
        _registerAlice();
        uint256 assetId = uint256(0x111);
        _mint(assetId, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        address newController = makeAddr("newController");
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.rotateController.selector,
            ALICE_DID,
            3,
            abi.encode(ALICE_DID, newController, keccak256("nk"))
        );
        vm.prank(ALICE);
        identity.rotateController(ALICE_DID, newController, keccak256("nk"), p);
        // Asset stays bound to the DID (not the address); root untouched.
        assertEq(assets.ownerDidOf(assetId), ALICE_DID);
        (bytes32 root, uint64 version) = _currentRoot(ALICE_DID);
        assertNotEq(root, bytes32(0));
        assertEq(version, 1);
        assertEq(identity.controllerOf(ALICE_DID), newController);
    }

    function test_BC_IDENT_012_013_014_statusTransitions() public {
        _registerAlice();
        Types.StepUpPermit memory p =
            _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 5, abi.encode(ALICE_DID, uint8(2)));
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.SUSPENDED, p);
        assertFalse(identity.isActive(ALICE_DID));
        // SUSPENDED -> ACTIVE (reinstatement)
        p = _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 6, abi.encode(ALICE_DID, uint8(1)));
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.ACTIVE, p);
        assertTrue(identity.isActive(ALICE_DID));
        // ACTIVE -> DEACTIVATED
        p = _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 7, abi.encode(ALICE_DID, uint8(3)));
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.DEACTIVATED, p);
        assertFalse(identity.isActive(ALICE_DID));
    }

    function test_BC_IDENT_014_deactivatedIsTerminal() public {
        _registerAlice();
        Types.StepUpPermit memory p =
            _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 5, abi.encode(ALICE_DID, uint8(3)));
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.DEACTIVATED, p);
        p = _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 6, abi.encode(ALICE_DID, uint8(1)));
        vm.expectRevert(Errors.InvalidStatusTransition.selector);
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.ACTIVE, p);
    }

    function test_BC_IDENT_015_setStatusUnknownDidReverts() public {
        Types.StepUpPermit memory p =
            _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 5, abi.encode(ALICE_DID, uint8(2)));
        vm.expectRevert(Errors.UnknownIdentity.selector);
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.SUSPENDED, p);
    }

    function test_BC_IDENT_018_019_viewsOnUnknownDid() public {
        Types.Identity memory none = identity.resolveIdentity(ALICE_DID);
        assertTrue(none.status == Types.IdentityStatus.NONE);
        assertFalse(identity.isActive(ALICE_DID));
        vm.expectRevert(Errors.UnknownIdentity.selector);
        identity.controllerOf(ALICE_DID);
    }

    function test_BC_PAUSE_008_pauserCanPauseWritesButNotViews() public {
        _registerAlice();
        vm.prank(PAUSER);
        identity.pause();
        // Views still work.
        identity.resolveIdentity(ALICE_DID);
        identity.isActive(ALICE_DID);
        // Writes revert while paused (OZ EnforcedPause).
        Types.StepUpPermit memory p =
            _permit(address(identity), identity.setIdentityStatus.selector, ALICE_DID, 9, abi.encode(ALICE_DID, uint8(2)));
        vm.expectRevert();
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.SUSPENDED, p);
        vm.prank(PAUSER);
        identity.unpause();
        // The paused call reverted, so its nonce was never consumed; the same
        // permit is still valid after unpause (nonce consumed only on success).
        identity.setIdentityStatus(ALICE_DID, Types.IdentityStatus.SUSPENDED, p);
        assertFalse(identity.isActive(ALICE_DID));
    }

    function test_BC_PAUSE_009_nonPauserCannotPause() public {
        vm.prank(ALICE);
        vm.expectRevert();
        identity.pause();
    }
}

/// @title BC-ROOT-001..005 — MerkleRootRegistry suite.
contract RootTest is Base {
    function test_BC_ROOT_001_unauthorizedInitializeReverts() public {
        vm.expectRevert(Errors.UnauthorizedRootWriter.selector);
        merkle.initializeRoot(ALICE_DID, EMPTY_ROOT_, keccak256("op"));
    }

    function test_BC_ROOT_002_unauthorizedTransitionReverts() public {
        vm.expectRevert(Errors.UnauthorizedRootWriter.selector);
        merkle.transitionRoot(ALICE_DID, EMPTY_ROOT_, 0, keccak256("r"), keccak256("op"));
    }

    function test_BC_ROOT_003_transitionRequiresExactOldRootAndVersion() public {
        _registerAlice();
        vm.startPrank(address(assets));
        vm.expectRevert(Errors.RootNotInitialized.selector);
        merkle.transitionRoot(CAROL_DID, EMPTY_ROOT_, 0, keccak256("r"), keccak256("op"));
        vm.expectRevert(Errors.StaleRoot.selector);
        merkle.transitionRoot(ALICE_DID, keccak256("wrong"), 0, keccak256("r"), keccak256("op"));
        vm.expectRevert(Errors.RootVersionMismatch.selector);
        merkle.transitionRoot(ALICE_DID, EMPTY_ROOT_, 1, keccak256("r"), keccak256("op"));
        vm.stopPrank();
    }

    function test_BC_ROOT_004_transitionAdvancesOneVersionAndStoresHistory() public {
        _registerAlice();
        bytes32 r1 = keccak256("root1");
        bytes32 r2 = keccak256("root2");
        vm.startPrank(address(assets));
        merkle.transitionRoot(ALICE_DID, EMPTY_ROOT_, 0, r1, keccak256("op1"));
        merkle.transitionRoot(ALICE_DID, r1, 1, r2, keccak256("op2"));
        vm.stopPrank();
        (bytes32 current, uint64 version,) = merkle.getCurrentRoot(ALICE_DID);
        assertEq(current, r2);
        assertEq(version, 2);
        (bytes32 hist, uint64 updatedAt1, bytes32 op1) = merkle.getRootAtVersion(ALICE_DID, 1);
        assertEq(hist, r1);
        assertEq(op1, keccak256("op1"));
        assertTrue(updatedAt1 > 0);
    }

    function test_BC_ROOT_005_emptyRootMatchesProtocol() public {
        assertEq(merkle.EMPTY_ROOT(), EMPTY_ROOT_);
        // Golden: SHA256(0x02)
        assertEq(
            EMPTY_ROOT_,
            sha256(hex"02")
        );
    }
}



