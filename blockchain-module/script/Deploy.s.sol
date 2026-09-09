// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MerkleRootRegistry} from "../src/MerkleRootRegistry.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {AssetAccessRegistry} from "../src/AssetAccessRegistry.sol";
import {InheritanceRegistry} from "../src/InheritanceRegistry.sol";

/// @title Deployment script per spec §2 deployment model.
/// @notice Deploys in the exact required order (MerkleRootRegistry ->
///         IdentityRegistry -> AssetAccessRegistry -> AssetRegistry ->
///         InheritanceRegistry), grants exact writer/role permissions,
///         asserts every final address/role/cross-contract writer permission
///         before completing, revokes bootstrap deployer privileges, and
///         writes a deployment manifest JSON (signature applied off-chain).
contract DeployScript is Script {
    MerkleRootRegistry public merkleRootRegistry;
    IdentityRegistry public identityRegistry;
    AssetAccessRegistry public assetAccessRegistry;
    AssetRegistry public assetRegistry;
    InheritanceRegistry public inheritanceRegistry;

    function run() external returns (address[] memory addresses, string memory manifestJson) {
        address governanceMultisig = vm.envOr("GOVERNANCE_MULTISIG", address(0xA11CE));
        address pauser = vm.envOr("PAUSER", address(0xB0B));
        address assetIssuer = vm.envOr("ASSET_ISSUER", address(0x1550));
        address attester = vm.envOr("STEP_UP_ATTESTER", address(0xA77E));
        address inheritanceExecutor = vm.envOr("INHERITANCE_EXECUTOR", address(0xE10));
        address auth1 = vm.envOr("AUTHORITY_1", address(0x1111));
        address auth2 = vm.envOr("AUTHORITY_2", address(0x2222));
        address auth3 = vm.envOr("AUTHORITY_3", address(0x3333));

        uint256 deployerKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);

        // 1. MerkleRootRegistry.
        merkleRootRegistry = new MerkleRootRegistry();
        // 2. IdentityRegistry with MerkleRootRegistry address.
        identityRegistry = new IdentityRegistry(address(merkleRootRegistry));
        // 3. AssetAccessRegistry.
        assetAccessRegistry = new AssetAccessRegistry();
        // 4. AssetRegistry with its dependencies.
        assetRegistry = new AssetRegistry();
        // 5. InheritanceRegistry with AssetRegistry address.
        inheritanceRegistry = new InheritanceRegistry();

        // Wire the (once-only) cross-contract writer permissions.
        merkleRootRegistry.setWriters(address(identityRegistry), address(assetRegistry));
        assetAccessRegistry.setWriters(address(identityRegistry), address(assetRegistry));
        assetRegistry.setWriters(
            address(identityRegistry),
            address(merkleRootRegistry),
            address(assetAccessRegistry),
            address(inheritanceRegistry)
        );
        inheritanceRegistry.setWriters(address(identityRegistry), address(assetRegistry));

        // 6. Grant exact writer/role permissions.
        _grantRoles(governanceMultisig, pauser, assetIssuer, attester, inheritanceExecutor, auth1, auth2, auth3);

        // 7. Assert every final address/role/cross-contract writer permission.
        _assertInvariants(
            governanceMultisig, pauser, assetIssuer, attester, inheritanceExecutor, auth1, auth2, auth3
        );

        // 8. Revoke bootstrap deployer privileges.
        bytes32 admin = identityRegistry.DEFAULT_ADMIN_ROLE();
        identityRegistry.revokeRole(admin, deployer);
        merkleRootRegistry.revokeRole(admin, deployer);
        assetRegistry.revokeRole(admin, deployer);
        assetAccessRegistry.revokeRole(admin, deployer);
        inheritanceRegistry.revokeRole(admin, deployer);

        vm.stopBroadcast();

        // 9. Write manifest (signed off-chain).
        string memory obj = "manifest";
        vm.serializeString(obj, "abiVersion", "1.0.0");
        vm.serializeString(obj, "chainId", vm.toString(block.chainid));
        vm.serializeAddress(obj, "merkleRootRegistry", address(merkleRootRegistry));
        vm.serializeAddress(obj, "identityRegistry", address(identityRegistry));
        vm.serializeAddress(obj, "assetAccessRegistry", address(assetAccessRegistry));
        vm.serializeAddress(obj, "assetRegistry", address(assetRegistry));
        vm.serializeAddress(obj, "inheritanceRegistry", address(inheritanceRegistry));
        vm.serializeAddress(obj, "governanceMultisig", governanceMultisig);
        vm.serializeAddress(obj, "pauser", pauser);
        vm.serializeAddress(obj, "assetIssuer", assetIssuer);
        vm.serializeAddress(obj, "stepUpAttester", attester);
        vm.serializeAddress(obj, "inheritanceExecutor", inheritanceExecutor);
        vm.serializeAddress(obj, "authority1", auth1);
        vm.serializeAddress(obj, "authority2", auth2);
        vm.serializeAddress(obj, "authority3", auth3);
        vm.serializeUint(obj, "deploymentBlock", block.number);
        vm.serializeUint(obj, "confirmationDepth", 1);
        manifestJson = vm.serializeAddress(obj, "deployer", deployer);

        string memory manifestPath = block.chainid == 11155111
            ? "./deployments/sepolia.json"
            : "./deployments/anvil.json";
        vm.createDir("./deployments", true);
        vm.writeFile(manifestPath, manifestJson);

        addresses = new address[](5);
        addresses[0] = address(merkleRootRegistry);
        addresses[1] = address(identityRegistry);
        addresses[2] = address(assetAccessRegistry);
        addresses[3] = address(assetRegistry);
        addresses[4] = address(inheritanceRegistry);

        console2.log("=========================================");
        console2.log("Deployment Successful!");
        console2.log("Manifest written to:", manifestPath);
        console2.log("IdentityRegistry:", address(identityRegistry));
        console2.log("MerkleRootRegistry:", address(merkleRootRegistry));
        console2.log("AssetAccessRegistry:", address(assetAccessRegistry));
        console2.log("AssetRegistry:", address(assetRegistry));
        console2.log("InheritanceRegistry:", address(inheritanceRegistry));
        console2.log("=========================================");
    }

    function _grantRoles(
        address governanceMultisig,
        address pauser,
        address assetIssuer,
        address attester,
        address inheritanceExecutor,
        address auth1,
        address auth2,
        address auth3
    ) private {
        identityRegistry.grantRole(identityRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig);
        identityRegistry.grantRole(identityRegistry.STEP_UP_ATTESTER_ROLE(), attester);
        identityRegistry.grantRole(identityRegistry.PAUSER_ROLE(), pauser);

        merkleRootRegistry.grantRole(merkleRootRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig);
        merkleRootRegistry.grantRole(merkleRootRegistry.STEP_UP_ATTESTER_ROLE(), attester);
        merkleRootRegistry.grantRole(merkleRootRegistry.PAUSER_ROLE(), pauser);

        assetRegistry.grantRole(assetRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig);
        assetRegistry.grantRole(assetRegistry.ASSET_ISSUER_ROLE(), assetIssuer);
        assetRegistry.grantRole(assetRegistry.STEP_UP_ATTESTER_ROLE(), attester);
        assetRegistry.grantRole(assetRegistry.PAUSER_ROLE(), pauser);

        assetAccessRegistry.grantRole(assetAccessRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig);
        assetAccessRegistry.grantRole(assetAccessRegistry.STEP_UP_ATTESTER_ROLE(), attester);
        assetAccessRegistry.grantRole(assetAccessRegistry.PAUSER_ROLE(), pauser);

        inheritanceRegistry.grantRole(inheritanceRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig);
        inheritanceRegistry.grantRole(inheritanceRegistry.STEP_UP_ATTESTER_ROLE(), attester);
        inheritanceRegistry.grantRole(inheritanceRegistry.INHERITANCE_EXECUTOR_ROLE(), inheritanceExecutor);
        inheritanceRegistry.grantRole(inheritanceRegistry.PAUSER_ROLE(), pauser);
        inheritanceRegistry.grantRole(inheritanceRegistry.INHERITANCE_AUTHORITY_ROLE(), auth1);
        inheritanceRegistry.grantRole(inheritanceRegistry.INHERITANCE_AUTHORITY_ROLE(), auth2);
        inheritanceRegistry.grantRole(inheritanceRegistry.INHERITANCE_AUTHORITY_ROLE(), auth3);
    }

    function _assertInvariants(
        address governanceMultisig,
        address pauser,
        address assetIssuer,
        address attester,
        address inheritanceExecutor,
        address auth1,
        address auth2,
        address auth3
    ) private view {
        // Cross-contract writer wiring.
        require(merkleRootRegistry.identityRegistry() == address(identityRegistry), "merkle writer: identity");
        require(merkleRootRegistry.assetRegistry() == address(assetRegistry), "merkle writer: asset");
        require(assetAccessRegistry.identityRegistry() == address(identityRegistry), "access: identity");
        require(assetAccessRegistry.assetRegistry() == address(assetRegistry), "access: asset");
        require(assetRegistry.identityRegistry() == address(identityRegistry), "asset: identity");
        require(assetRegistry.merkleRootRegistry() == address(merkleRootRegistry), "asset: merkle");
        require(assetRegistry.assetAccessRegistry() == address(assetAccessRegistry), "asset: access");
        require(assetRegistry.inheritanceRegistry() == address(inheritanceRegistry), "asset: inheritance");
        require(inheritanceRegistry.identityRegistry() == address(identityRegistry), "inheritance: identity");
        require(inheritanceRegistry.assetRegistry() == address(assetRegistry), "inheritance: asset");

        // Role matrix.
        require(identityRegistry.hasRole(identityRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig), "admin: id");
        require(merkleRootRegistry.hasRole(merkleRootRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig), "admin: mr");
        require(assetRegistry.hasRole(assetRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig), "admin: asset");
        require(assetAccessRegistry.hasRole(assetAccessRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig), "admin: acc");
        require(inheritanceRegistry.hasRole(inheritanceRegistry.DEFAULT_ADMIN_ROLE(), governanceMultisig), "admin: inh");
        require(assetRegistry.hasRole(assetRegistry.ASSET_ISSUER_ROLE(), assetIssuer), "issuer");
        require(identityRegistry.hasRole(identityRegistry.STEP_UP_ATTESTER_ROLE(), attester), "attester: id");
        require(merkleRootRegistry.hasRole(merkleRootRegistry.STEP_UP_ATTESTER_ROLE(), attester), "attester: mr");
        require(assetRegistry.hasRole(assetRegistry.STEP_UP_ATTESTER_ROLE(), attester), "attester: asset");
        require(assetAccessRegistry.hasRole(assetAccessRegistry.STEP_UP_ATTESTER_ROLE(), attester), "attester: acc");
        require(inheritanceRegistry.hasRole(inheritanceRegistry.STEP_UP_ATTESTER_ROLE(), attester), "attester: inh");
        require(
            inheritanceRegistry.hasRole(inheritanceRegistry.INHERITANCE_EXECUTOR_ROLE(), inheritanceExecutor),
            "executor"
        );
        require(inheritanceRegistry.hasRole(inheritanceRegistry.INHERITANCE_AUTHORITY_ROLE(), auth1), "auth1");
        require(inheritanceRegistry.hasRole(inheritanceRegistry.INHERITANCE_AUTHORITY_ROLE(), auth2), "auth2");
        require(inheritanceRegistry.hasRole(inheritanceRegistry.INHERITANCE_AUTHORITY_ROLE(), auth3), "auth3");
        require(identityRegistry.hasRole(identityRegistry.PAUSER_ROLE(), pauser), "pauser: id");
        require(merkleRootRegistry.hasRole(merkleRootRegistry.PAUSER_ROLE(), pauser), "pauser: mr");
        require(assetRegistry.hasRole(assetRegistry.PAUSER_ROLE(), pauser), "pauser: asset");
        require(assetAccessRegistry.hasRole(assetAccessRegistry.PAUSER_ROLE(), pauser), "pauser: acc");
        require(inheritanceRegistry.hasRole(inheritanceRegistry.PAUSER_ROLE(), pauser), "pauser: inh");
    }
}
