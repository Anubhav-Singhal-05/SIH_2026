// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Types} from "../src/Types.sol";
import {Errors} from "../src/Errors.sol";
import {MerkleLib} from "../src/Protocol.sol";

/// @title Invariant / fuzz suite: INV-08 nominee cannot activate, INV-04 one
///        owner per asset, root versions advance by exactly one.
contract InvariantTest is Base {
    uint256 constant A1 = 0x4001;

    function _setRule(bytes32 ownerDid, bytes32 nominee) internal {
        Types.StepUpPermit memory p = _permit(
            address(inheritance),
            inheritance.setInheritanceRule.selector,
            ownerDid,
            40,
            abi.encode(ownerDid, nominee, new uint256[](0), new bytes32[](0), keccak256("policy"))
        );
        vm.prank(ALICE);
        inheritance.setInheritanceRule(ownerDid, nominee, new uint256[](0), new bytes32[](0), keccak256("policy"), p);
    }

    /// @dev BC-INHER-017 (fuzz): a nominee alone, regardless of any evidence,
    ///      can never activate inheritance.
    function test_BC_INHER_017_fuzz_nomineeAloneCanNeverActivate(uint96 seed) public {
        _registerAlice();
        bytes32 nomineeDid = keccak256(abi.encode("nominee", seed));
        _register(nomineeDid, vm.addr(uint256(seed) % type(uint160).max + 1), 55);
        _setRule(ALICE_DID, nomineeDid);

        address nomineeController = identity.controllerOf(nomineeDid);
        bytes32 evidence = keccak256(abi.encode("evidence", seed));
        uint64 expiry = uint64(block.timestamp + 10 minutes);

        Types.AuthoritySignature[] memory sigs = new Types.AuthoritySignature[](2);
        (uint8 v, bytes32 r, bytes32 s) = _signBy(nomineeController, ALICE_DID, evidence, expiry);
        sigs[0] = Types.AuthoritySignature(nomineeController, abi.encodePacked(r, s, v));
        (v, r, s) = _signBy(AUTH1, ALICE_DID, evidence, expiry);
        sigs[1] = Types.AuthoritySignature(AUTH1, abi.encodePacked(r, s, v));

        vm.expectRevert(Errors.NomineeCannotActivate.selector);
        inheritance.activateInheritance(ALICE_DID, evidence, 0, expiry, sigs);
    }

    function _signBy(address signer, bytes32 ownerDid, bytes32 evidence, uint64 expiry)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        uint256 key = vm.envOr("ANY_KEY", uint256(0));
        key = uint256(uint160(signer));
        bytes32 typeHash = keccak256(
            "InheritanceActivation(bytes32 ownerDidHash,bytes32 evidenceHash,uint256 authoritySetVersion,"
                "uint64 activationNonce,uint64 expiresAt)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, ownerDid, evidence, uint256(0), uint64(0), expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", inheritance.domainSeparator(), structHash));
        return vm.sign(key, digest);
    }

    function test_INV_004_exactlyOneOwnerPerAssetAcrossLifecycle() public {
        _registerAlice();
        _registerBob();
        _registerCarol();
        // Mint: exactly one owner.
        _mint(A1, ALICE_DID, ALICE, EMPTY_ROOT_, 0);
        assertEq(assets.ownerDidOf(A1), ALICE_DID);
        // Transfer: still exactly one owner.
        (bytes32 aliceRoot, uint64 aliceVersion) = _currentRoot(ALICE_DID);
        Types.Asset memory a = assets.getAsset(A1);
        bytes32 bobNew = MerkleLib.leaf(A1, BOB_DID, a.documentHash, a.metadataHash, a.documentVersion);
        Types.StepUpPermit memory p = _permit(
            address(assets),
            assets.transferAsset.selector,
            ALICE_DID,
            80,
            abi.encode(A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, bobNew, 0)
        );
        vm.prank(ALICE);
        assets.transferAsset(
            A1, ALICE_DID, BOB_DID, aliceRoot, EMPTY_ROOT_, aliceVersion, EMPTY_ROOT_, bobNew, 0, p
        );
        assertEq(assets.ownerDidOf(A1), BOB_DID);
        // Deactivate: owner remains the last owner (auditable), status terminal.
        (bytes32 bobRoot, uint64 bobVersion) = _currentRoot(BOB_DID);
        Types.Asset memory b = assets.getAsset(A1);
        Types.StepUpPermit memory dp = _permit(
            address(assets),
            assets.deactivateAsset.selector,
            BOB_DID,
            81,
            abi.encode(A1, bobRoot, EMPTY_ROOT_, bobVersion)
        );
        vm.prank(BOB);
        assets.deactivateAsset(A1, bobRoot, EMPTY_ROOT_, bobVersion, dp);
        assertEq(assets.ownerDidOf(A1), BOB_DID);
        assertTrue(assets.getAsset(A1).status == Types.AssetStatus.DEACTIVATED);
    }

    function test_INV_006_rootVersionsAdvanceExactlyOnePerTransition() public {
        _registerAlice();
        uint64 lastVersion = 0;
        for (uint256 i = 0; i < 3; ++i) {
            uint256 assetId = 0x5000 + i;
            (bytes32 root, uint64 version) = _currentRoot(ALICE_DID);
            assertEq(version, lastVersion);
            _mint(assetId, ALICE_DID, ALICE, root, version);
            (, uint64 newVersion) = _currentRoot(ALICE_DID);
            assertEq(newVersion, version + 1);
            lastVersion = newVersion;
        }
    }
}

