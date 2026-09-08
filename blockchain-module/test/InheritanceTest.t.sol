// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib} from "../src/Protocol.sol";

/// @title BC-INHER-001..017 — inheritance suite.
contract InheritanceTest is Base {
    uint256 constant A1 = 0x2001;

    function _setRule(bytes32 ownerDid, address controller, uint64 nonce) internal {
        _register(NOMINEE_DID, CAROL, 50);
        uint256[] memory assetIds = new uint256[](0);
        bytes32[] memory beneficiaries = new bytes32[](0);
        Types.StepUpPermit memory p = _permit(
            address(inheritance),
            inheritance.setInheritanceRule.selector,
            ownerDid,
            nonce,
            abi.encode(ownerDid, NOMINEE_DID, assetIds, beneficiaries, keccak256("policy"))
        );
        vm.prank(controller);
        inheritance.setInheritanceRule(ownerDid, NOMINEE_DID, assetIds, beneficiaries, keccak256("policy"), p);
    }

    function _sig(address signer, uint256 key, bytes32 ownerDid, bytes32 evidence, uint256 asv, uint64 nonce, uint64 expiry)
        internal
        view
        returns (Types.AuthoritySignature memory)
    {
        bytes32 typeHash = keccak256(
            "InheritanceActivation(bytes32 ownerDidHash,bytes32 evidenceHash,uint256 authoritySetVersion,"
                "uint64 activationNonce,uint64 expiresAt)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, ownerDid, evidence, asv, nonce, expiry));
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", inheritance.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return Types.AuthoritySignature(signer, abi.encodePacked(r, s, v));
    }

    function _activate(bytes32 ownerDid) internal {
        bytes32 evidence = keccak256("evidence");
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](2);
        sigs[0] = _sig(AUTH1, 0x11111, ownerDid, evidence, 0, 0, expiry);
        sigs[1] = _sig(AUTH2, 0x22222, ownerDid, evidence, 0, 0, expiry);
        inheritance.activateInheritance(ownerDid, evidence, 0, expiry, sigs);
    }

    function test_BC_INHER_001_002_setRuleAndActivationSucceeds() public {
        _registerAlice();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _setRule(ALICE_DID, ALICE, 40);
        _activate(ALICE_DID);
        assertTrue(inheritance.getRule(ALICE_DID).status == Types.InheritanceStatus.ACTIVE);
        assertEq(inheritance.getRule(ALICE_DID).activationNonce, 1);
    }

    function test_BC_INHER_003_setRuleByNonOwnerReverts() public {
        _registerAlice();
        _registerBob();
        uint256[] memory assetIds = new uint256[](0);
        bytes32[] memory beneficiaries = new bytes32[](0);
        vm.prank(BOB);
        Types.StepUpPermit memory p = _permit(
            address(inheritance),
            inheritance.setInheritanceRule.selector,
            ALICE_DID,
            40,
            abi.encode(ALICE_DID, NOMINEE_DID, assetIds, beneficiaries, keccak256("policy"))
        );
        vm.expectRevert(Errors.CallerNotController.selector);
        inheritance.setInheritanceRule(ALICE_DID, NOMINEE_DID, assetIds, beneficiaries, keccak256("policy"), p);
    }

    function test_BC_INHER_005_fewerThanThresholdReverts() public {
        _registerAlice();
        _setRule(ALICE_DID, ALICE, 40);
        bytes32 evidence = keccak256("evidence");
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](1);
        sigs[0] = _sig(AUTH1, 0x11111, ALICE_DID, evidence, 0, 0, expiry);
        vm.expectRevert(Errors.InsufficientAuthoritySignatures.selector);
        inheritance.activateInheritance(ALICE_DID, evidence, 0, expiry, sigs);
    }

    function test_BC_INHER_007_duplicateAuthorityReverts() public {
        _registerAlice();
        _setRule(ALICE_DID, ALICE, 40);
        bytes32 evidence = keccak256("evidence");
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](2);
        sigs[0] = _sig(AUTH1, 0x11111, ALICE_DID, evidence, 0, 0, expiry);
        sigs[1] = _sig(AUTH1, 0x11111, ALICE_DID, evidence, 0, 0, expiry);
        vm.expectRevert(Errors.DuplicateAuthority.selector);
        inheritance.activateInheritance(ALICE_DID, evidence, 0, expiry, sigs);
    }

    function test_BC_INHER_008_expiredAuthoritySignatureReverts() public {
        _registerAlice();
        _setRule(ALICE_DID, ALICE, 40);
        bytes32 evidence = keccak256("evidence");
        uint64 expiry = uint64(block.timestamp - 1);
        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](2);
        sigs[0] = _sig(AUTH1, 0x11111, ALICE_DID, evidence, 0, 0, expiry);
        sigs[1] = _sig(AUTH2, 0x22222, ALICE_DID, evidence, 0, 0, expiry);
        vm.expectRevert(Errors.AuthoritySignatureExpired.selector);
        inheritance.activateInheritance(ALICE_DID, evidence, 0, expiry, sigs);
    }

    function test_BC_INHER_006_nomineeCannotActivate() public {
        _registerAlice();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _setRule(ALICE_DID, ALICE, 40);
        // The nominee's controller (Carol) attempts to count a nominee-signed
        // assertion toward the threshold. Must revert NomineeCannotActivate.
        bytes32 evidence = keccak256("evidence");
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](2);
        sigs[0] = _sig(CAROL, CAROL_KEY, ALICE_DID, evidence, 0, 0, expiry);
        sigs[1] = _sig(AUTH1, 0x11111, ALICE_DID, evidence, 0, 0, expiry);
        vm.expectRevert(Errors.NomineeCannotActivate.selector);
        inheritance.activateInheritance(ALICE_DID, evidence, 0, expiry, sigs);
    }

    function test_BC_INHER_010_executeBeforeActivationReverts() public {
        _registerAlice();
        vm.prank(EXECUTOR);
        vm.expectRevert(Errors.InheritanceNotActive.selector);
        inheritance.executeInheritanceBatch(
            ALICE_DID, new uint256[](0), new bytes32[](0), new Types.RootTransition[](0)
        );
    }

    function test_BC_INHER_011_batchTooLargeReverts() public {
        _registerAlice();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _setRule(ALICE_DID, ALICE, 40);
        _activate(ALICE_DID);

        uint256[] memory assetIds = new uint256[](51);
        bytes32[] memory beneficiaries = new bytes32[](51);
        for (uint256 i = 0; i < 51; ++i) {
            assetIds[i] = i + 1;
            beneficiaries[i] = NOMINEE_DID;
        }
        vm.prank(EXECUTOR);
        vm.expectRevert(Errors.BatchTooLarge.selector);
        inheritance.executeInheritanceBatch(ALICE_DID, assetIds, beneficiaries, new Types.RootTransition[](102));
    }

    function test_BC_INHER_012_transferToNonRuleBeneficiaryReverts() public {
        _registerAlice();
        _registerCarol();
        _registerBob();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _setRule(ALICE_DID, ALICE, 40);
        _activate(ALICE_DID);

        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        Types.Asset memory a = assets.getAsset(A1);
        bytes32 bobNew = MerkleLib.leaf(A1, BOB_DID, a.documentHash, a.metadataHash, a.documentVersion);

        uint256[] memory assetIds = new uint256[](1);
        assetIds[0] = A1;
        bytes32[] memory beneficiaries = new bytes32[](1);
        beneficiaries[0] = BOB_DID; // not the nominee, not the override
        Types.RootTransition[] memory transitions = new Types.RootTransition[](2);
        transitions[0] = Types.RootTransition(ALICE_DID, aliceRoot, aliceVersion, EMPTY_ROOT_);
        transitions[1] = Types.RootTransition(BOB_DID, EMPTY_ROOT_, 0, bobNew);
        vm.prank(EXECUTOR);
        vm.expectRevert(Errors.InvalidBeneficiary.selector);
        inheritance.executeInheritanceBatch(ALICE_DID, assetIds, beneficiaries, transitions);
    }
}

/// @title BC-INHER-013..016 — restricted execution, atomicity, and close.
contract InheritanceExecutionTest is Base {
    uint256 constant A1 = 0x2001;

    function _rule(bytes32 ownerDid) internal {
        _register(NOMINEE_DID, CAROL, 50);
        Types.StepUpPermit memory p = _permit(
            address(inheritance),
            inheritance.setInheritanceRule.selector,
            ownerDid,
            40,
            abi.encode(ownerDid, NOMINEE_DID, new uint256[](0), new bytes32[](0), keccak256("policy"))
        );
        vm.prank(ALICE);
        inheritance.setInheritanceRule(ownerDid, NOMINEE_DID, new uint256[](0), new bytes32[](0), keccak256("policy"), p);
    }

    function _sig(address signer, uint256 key, bytes32 ownerDid, bytes32 evidence, uint64 expiry)
        internal
        view
        returns (Types.AuthoritySignature memory)
    {
        bytes32 typeHash = keccak256(
            "InheritanceActivation(bytes32 ownerDidHash,bytes32 evidenceHash,uint256 authoritySetVersion,"
                "uint64 activationNonce,uint64 expiresAt)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, ownerDid, evidence, uint256(0), uint64(0), expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", inheritance.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return Types.AuthoritySignature(signer, abi.encodePacked(r, s, v));
    }

    function _activate(bytes32 ownerDid) internal {
        bytes32 evidence = keccak256("evidence");
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](2);
        sigs[0] = _sig(AUTH1, 0x11111, ownerDid, evidence, expiry);
        sigs[1] = _sig(AUTH2, 0x22222, ownerDid, evidence, expiry);
        inheritance.activateInheritance(ownerDid, evidence, 0, expiry, sigs);
    }

    function _execute(bytes32 ownerDid) internal {
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ownerDid);
        Types.Asset memory a = assets.getAsset(A1);
        bytes32 nomineeNew = MerkleLib.leaf(A1, NOMINEE_DID, a.documentHash, a.metadataHash, a.documentVersion);
        uint256[] memory assetIds = new uint256[](1);
        assetIds[0] = A1;
        bytes32[] memory beneficiaries = new bytes32[](1);
        beneficiaries[0] = NOMINEE_DID;
        Types.RootTransition[] memory transitions = new Types.RootTransition[](2);
        transitions[0] = Types.RootTransition(ownerDid, aliceRoot, aliceVersion, EMPTY_ROOT_);
        transitions[1] = Types.RootTransition(NOMINEE_DID, EMPTY_ROOT_, 0, nomineeNew);
        vm.prank(EXECUTOR);
        inheritance.executeInheritanceBatch(ownerDid, assetIds, beneficiaries, transitions);
    }

    function test_BC_INHER_013_batchExecutesThroughRestrictedPathAtomically() public {
        _registerAlice();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _rule(ALICE_DID);
        _activate(ALICE_DID);
        _execute(ALICE_DID);
        assertEq(assets.ownerDidOf(A1), NOMINEE_DID);
        (bytes32 nomineeRoot, uint64 nomineeVersion) = _currentRoot(NOMINEE_DID);
        Types.Asset memory a = assets.getAsset(A1);
        assertEq(nomineeRoot, MerkleLib.leaf(A1, NOMINEE_DID, a.documentHash, a.metadataHash, a.documentVersion));
        assertEq(nomineeVersion, 1);
    }

    function test_BC_INHER_014_staleSecondBatchFailsEntirely() public {
        _registerAlice();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _rule(ALICE_DID);
        _activate(ALICE_DID);
        _execute(ALICE_DID);

        // Owner root is now EMPTY; a replayed batch with the old owner root is
        // stale and fails entirely — no partial transfers.
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        Types.Asset memory a = assets.getAsset(A1);
        uint256[] memory assetIds = new uint256[](1);
        assetIds[0] = A1;
        bytes32[] memory beneficiaries = new bytes32[](1);
        beneficiaries[0] = NOMINEE_DID;
        Types.RootTransition[] memory transitions = new Types.RootTransition[](2);
        transitions[0] = Types.RootTransition(ALICE_DID, aliceRoot, aliceVersion, EMPTY_ROOT_);
        transitions[1] = Types.RootTransition(
            NOMINEE_DID, EMPTY_ROOT_, 1, MerkleLib.leaf(A1, NOMINEE_DID, a.documentHash, a.metadataHash, 1)
        );
        vm.prank(EXECUTOR);
        vm.expectRevert();
        inheritance.executeInheritanceBatch(ALICE_DID, assetIds, beneficiaries, transitions);
    }

    function test_BC_INHER_016_closeInheritanceStopsFurtherBatches() public {
        _registerAlice();
        _registerCarol();
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        _rule(ALICE_DID);
        _activate(ALICE_DID);
        _execute(ALICE_DID);

        vm.prank(EXECUTOR);
        inheritance.closeInheritance(ALICE_DID);
        assertTrue(inheritance.getRule(ALICE_DID).status == Types.InheritanceStatus.CLOSED);

        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        uint256[] memory assetIds = new uint256[](1);
        assetIds[0] = A1;
        bytes32[] memory beneficiaries = new bytes32[](1);
        beneficiaries[0] = NOMINEE_DID;
        Types.RootTransition[] memory transitions = new Types.RootTransition[](2);
        transitions[0] = Types.RootTransition(ALICE_DID, aliceRoot, aliceVersion, EMPTY_ROOT_);
        transitions[1] = Types.RootTransition(NOMINEE_DID, EMPTY_ROOT_, 1, EMPTY_ROOT_);
        vm.prank(EXECUTOR);
        vm.expectRevert(Errors.InheritanceNotActive.selector);
        inheritance.executeInheritanceBatch(ALICE_DID, assetIds, beneficiaries, transitions);
    }
}

