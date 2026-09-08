// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib, OperationHash} from "../src/Protocol.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

/// @title BC-PERMIT-001..014 — common StepUpPermit verifier suite.
contract PermitTest is Base {
    function _args() internal view returns (bytes memory) {
        return abi.encode(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_);
    }

    function _validPermit(uint64 nonce) internal view returns (Types.StepUpPermit memory) {
        return _permit(address(identity), identity.registerIdentity.selector, ALICE_DID, nonce, _args());
    }

    function _reg() internal {
        Types.StepUpPermit memory p = _validPermit(1); // compute BEFORE prank
        vm.prank(ALICE);
        identity.registerIdentity(
            ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p
        );
    }

    function test_BC_PERMIT_001_validPermitSucceeds() public {
        _reg();
        assertTrue(identity.isActive(ALICE_DID));
    }

    function test_BC_PERMIT_002_nonAttesterSignerReverts() public {
        Types.StepUpPermit memory p = _validPermit(1);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(0xDEAD, _digest(identity.domainSeparator(), p.operationHash, p.didHash, p.expiresAt, p.nonce));
        p.signature = abi.encodePacked(r, s, v);
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function test_BC_PERMIT_003_expiredPermitReverts() public {
        Types.StepUpPermit memory p = _validPermit(1);
        p.expiresAt = uint64(block.timestamp - 1);
        p = _sign(address(identity), p);
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function test_BC_PERMIT_004_reusedNonceReverts() public {
        _reg();
        bytes32 other = keccak256("did:other");
        Types.StepUpPermit memory p2 = _permit(
            address(identity),
            identity.registerIdentity.selector,
            other,
            1,
            abi.encode(other, BOB, keccak256("k"), keccak256("r"), EMPTY_ROOT_)
        );
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(other, BOB, keccak256("k"), keccak256("r"), EMPTY_ROOT_, p2);
    }

    function test_BC_PERMIT_005_didHashMismatchReverts() public {
        bytes32 wrongDid = keccak256("did:someone-else");
        Types.StepUpPermit memory p = _permit(address(identity), identity.registerIdentity.selector, ALICE_DID, 1, _args());
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(wrongDid, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function test_BC_PERMIT_006_callerNotControllerReverts() public {
        Types.StepUpPermit memory p = _validPermit(1);
        vm.prank(BOB);
        vm.expectRevert(Errors.CallerNotController.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function test_BC_PERMIT_007_operationHashTamperReverts() public {
        Types.StepUpPermit memory p = _validPermit(1);
        p.operationHash = keccak256("tampered");
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    /// HOLD (design decision D1): contract-level rejection of a permit whose
    /// operationHash was computed for a different chainId requires recomputing
    /// the operation hash on-chain from msg.data — a breaking cross-module
    /// interface change. Currently chainId is bound by the EIP-712 domain and
    /// the selector/args by the attester (HSM) + backend. Deferred.
    function HOLD_BC_PERMIT_008_wrongChainIdReverts() public view {}

    function test_BC_PERMIT_009_wrongContractReverts() public {
        Types.StepUpPermit memory p = _permit(address(assets), identity.registerIdentity.selector, ALICE_DID, 1, _args());
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    /// HOLD (design decision D1): see HOLD_BC_PERMIT_008 — selector binding is
    /// enforced by the attester/backend until on-chain opHash recomputation.
    function HOLD_BC_PERMIT_010_wrongSelectorReverts() public view {}

    function test_BC_PERMIT_012_viewFunctionsNeedNoPermit() public {
        _reg();
        identity.resolveIdentity(ALICE_DID);
        identity.controllerOf(ALICE_DID);
        assertTrue(identity.isActive(ALICE_DID));
        (, uint64 v,) = merkle.getCurrentRoot(ALICE_DID);
        assertEq(v, 0);
    }

    function test_BC_PERMIT_013_fuzz_operationHashMutationInvalidates(bytes32 opHashMut) public {
        vm.assume(
            opHashMut
                != OperationHash.compute(
                    address(identity), identity.registerIdentity.selector, ALICE_DID, 1, EXPIRES_AT, _args()
                )
        );
        Types.StepUpPermit memory p = _validPermit(1);
        p.operationHash = opHashMut;
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(ALICE_DID, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, p);
    }

    function test_BC_PERMIT_014_replayOfConsumedPermitReverts() public {
        _reg();
        // Replay against a fresh DID reverts on the consumed nonce (global).
        bytes32 fresh = keccak256("did:fresh");
        Types.StepUpPermit memory forged = _validPermit(1);
        forged.didHash = fresh;
        vm.prank(ALICE);
        vm.expectRevert(Errors.InvalidPermit.selector);
        identity.registerIdentity(fresh, ALICE, keccak256("key"), keccak256("recovery"), EMPTY_ROOT_, forged);
    }

    function test_BC_PERMIT_011_nonceConsumedBeforeEffects() public {
        ReentrantAttacker attacker = new ReentrantAttacker(identity);
        bytes32 didHash = bytes32(uint256(77));
        Types.StepUpPermit memory p = _permit(
            address(identity),
            identity.registerIdentity.selector,
            didHash,
            42,
            abi.encode(didHash, address(attacker), keccak256("k"), keccak256("r"), EMPTY_ROOT_)
        );
        attacker.attack(didHash, keccak256("k"), keccak256("r"), EMPTY_ROOT_, p);
        assertTrue(attacker.reenteredRejected());
        assertTrue(identity.isActive(didHash));
    }
}

contract ReentrantAttacker {
    IdentityRegistry public identity;
    bool public reenteredRejected;

    constructor(IdentityRegistry identity_) {
        identity = identity_;
    }

    function attack(bytes32 didHash, bytes32 key, bytes32 recovery, bytes32 root, Types.StepUpPermit memory permit)
        external
    {
        // Nonce is consumed strictly before effects, so this first call succeeds.
        identity.registerIdentity(didHash, address(this), key, recovery, root, permit);
        // Immediate re-entry with the same permit must fail on the used nonce.
        try identity.registerIdentity(didHash, address(this), key, recovery, root, permit) {
            revert("re-entry should have failed");
        } catch (bytes memory reason) {
            reenteredRejected = (bytes4(reason) == Errors.InvalidPermit.selector);
        }
    }
}



