import { randomUUID } from 'node:crypto';
import { DomainError, ErrorCode } from './errors.js';
import { didHash as computeDidHash, normalizeHex32 } from './did.js';
import { EMPTY_ROOT, leaf as computeLeaf, rootOf } from './merkle.js';

/**
 * Asset registration, transfer, access, update, and deactivation workflows.
 * A staged document becomes CONFIRMED only via finalizeChainEvent() — never from
 * the API or a receipt alone (BE-MINT-017, BE-DOD-003).
 */
export class AssetsService {
  constructor(repo, storage, chain, stepUp, config) {
    this.repo = repo;
    this.storage = storage;
    this.chain = chain;
    this.stepUp = stepUp;
    this.config = config;
  }

  async createUploadIntent(callerDidHash, contentType, sizeBytes) {
    await this.repo.identitiesRepo.requireActive(callerDidHash); // BE-MINT-001
    if (!this.config.mimeAllowlist.includes(contentType)) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'content type not allowed'); // BE-MINT-002
    }
    if (sizeBytes <= 0 || sizeBytes > this.config.uploadMaxBytes) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'size policy violated'); // BE-MINT-003
    }
    // Checksum is declared by the client (computed in-browser) and verified at
    // finalize; the backend never sees plaintext (BE-MINT-005).
    const checksum = randomUUID().replace(/-/g, '0').padEnd(64, '0');
    const scoped = await this.storage.createUploadIntent({
      checksumSha256: checksum,
      contentType,
      maxBytes: sizeBytes,
    });
    await this.repo.saveStaged({
      stagedId: scoped.stagedId,
      ownerDidHash: callerDidHash,
      objectKey: scoped.objectKey,
      checksumSha256: checksum,
      byteSize: sizeBytes,
      contentType,
      status: 'STAGED',
      createdAt: Date.now(),
    });
    return {
      stagedId: scoped.stagedId,
      uploadUrl: scoped.uploadUrl,
      objectKey: scoped.objectKey,
      expiresAt: scoped.expiresAt,
    };
  }

  async finalizeUpload(callerDidHash, { stagedId, expectedChecksumSha256, expectedByteSize }) {
    const staged = await this.repo.getStaged(stagedId);
    if (!staged || staged.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'staged object not found');
    }
    await this.storage.finalizeStagedObject(stagedId, staged.objectKey, {
      stagedId,
      expectedChecksumSha256,
      expectedByteSize,
    });
    staged.checksumSha256 = String(expectedChecksumSha256).toLowerCase();
    staged.byteSize = expectedByteSize;
    await this.repo.saveStaged(staged);
    return { stagedId, status: staged.status };
  }

  /**
   * Mint intent (BE-MINT-007..015): issuer role, active owner, staged doc,
   * DIRECT chain read of root/version (BE-MINT-010), projection cross-check
   * (BE-MINT-011), reserved random asset ID (BE-MINT-012), next root from the
   * active snapshot (BE-MINT-014), step-up-bound calldata (BE-MINT-015).
   */
  async createMintIntent({ callerDid, ownerDid, stagedId, issuerRole, verified, requestDigest }) {
    const callerDidHash = computeDidHash(callerDid);
    if (!issuerRole) throw new DomainError(ErrorCode.FORBIDDEN, 'issuer role required');

    const ownerDidHash = computeDidHash(ownerDid);
    await this.repo.identitiesRepo.requireActive(ownerDidHash); // BE-MINT-008

    const staged = await this.repo.getStaged(stagedId);
    if (!staged || staged.status !== 'STAGED' || staged.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'staged document not active');
    }

    // BE-MINT-010: direct on-chain read, never projection-only for high risk.
    const chainRoot = await this.chain.getRoot(ownerDidHash);

    // BE-MINT-011: finalized projection must agree with the chain version.
    const projection = await this.repo.activeLeaves(ownerDidHash);
    if (projection.oldVersion !== chainRoot.version) {
      throw new DomainError(ErrorCode.STALE_ROOT, 'projection diverges from chain');
    }

    const assetId = BigInt('0x' + randomUUID().replace(/-/g, '')).toString(); // 128-bit random
    const documentHash = '0x' + staged.checksumSha256;
    const metadataHash = '0x' + staged.checksumSha256.split('').reverse().join('');

    // BE-MINT-014: next root from the exact active snapshot (ordered by assetId ascending).
    const newLeaf = computeLeaf(BigInt(assetId), ownerDidHash, documentHash, metadataHash, 1n);
    const allLeaves = [...projection.leaves, { assetId: BigInt(assetId), leaf: newLeaf }];
    allLeaves.sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
    const nextRoot = rootOf(allLeaves.map((l) => l.leaf));

    const abi = this.chain.abis.AssetRegistry;
    const args = [
      BigInt(assetId),
      ownerDidHash,
      documentHash,
      metadataHash,
      '0x' + '0'.repeat(64),
      chainRoot.root,
      nextRoot,
      chainRoot.version,
    ];
    const intent = await this.stepUp.createPermitIntent({
      callerDid,
      contractAddress: this.chain.addressOf('assetRegistry'),
      abi,
      functionName: 'registerAsset',
      args,
      kind: 'MINT',
      endpoint: 'POST /assets/mint-intent',
      requestDigest,
      verified,
    });

    const op = await this.repo.getOperation(intent.operationId);
    if (op) {
      op.reservedAssetId = assetId;
      await this.repo.saveOperation(op);
    }
    return {
      operationId: intent.operationId,
      assetId,
      calldata: intent.calldata,
      target: intent.target,
      permit: intent.permit,
    };
  }

  /** Transfer intent workflow (BE-TRANSFER-001..012) */
  async createTransferIntent({ callerDid, assetId, toDid, verified, requestDigest }) {
    const callerDidHash = computeDidHash(callerDid);
    const toDidHash = computeDidHash(toDid);

    await this.repo.identitiesRepo.requireActive(callerDidHash);
    await this.repo.identitiesRepo.requireActive(toDidHash);

    const asset = await this.repo.getAsset(assetId);
    if (!asset || String(asset.status).toUpperCase() !== 'ACTIVE') {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found or inactive');
    }
    if (asset.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'caller is not current asset owner');
    }

    // Direct on-chain reads for both sender and recipient
    const fromChainRoot = await this.chain.getRoot(callerDidHash);
    const toChainRoot = await this.chain.getRoot(toDidHash);

    const fromProj = await this.repo.activeLeaves(callerDidHash);
    const toProj = await this.repo.activeLeaves(toDidHash);

    if (fromProj.oldVersion !== fromChainRoot.version || toProj.oldVersion !== toChainRoot.version) {
      throw new DomainError(ErrorCode.STALE_ROOT, 'root projection stale');
    }

    // Compute new roots
    const fromLeaves = fromProj.leaves.filter((l) => l.assetId !== BigInt(assetId)).map((l) => l.leaf);
    const fromNewRoot = fromLeaves.length === 0 ? EMPTY_ROOT : rootOf(fromLeaves);

    const recipientLeaf = computeLeaf(
      BigInt(assetId),
      toDidHash,
      asset.documentHash,
      asset.metadataHash,
      asset.documentVersion
    );
    const toAllLeaves = [...toProj.leaves, { assetId: BigInt(assetId), leaf: recipientLeaf }];
    toAllLeaves.sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
    const toNewRoot = rootOf(toAllLeaves.map((l) => l.leaf));

    const abi = this.chain.abis.AssetRegistry;
    const args = [
      BigInt(assetId),
      callerDidHash,
      toDidHash,
      fromChainRoot.root,
      fromNewRoot,
      fromChainRoot.version,
      toChainRoot.root,
      toNewRoot,
      toChainRoot.version,
    ];

    const intent = await this.stepUp.createPermitIntent({
      callerDid,
      contractAddress: this.chain.addressOf('assetRegistry'),
      abi,
      functionName: 'transferAsset',
      args,
      kind: 'TRANSFER',
      endpoint: `POST /assets/${assetId}/transfer-intent`,
      requestDigest,
      verified,
    });

    return {
      operationId: intent.operationId,
      assetId: String(assetId),
      fromDid: callerDid,
      toDid,
      calldata: intent.calldata,
      target: intent.target,
      permit: intent.permit,
    };
  }

  /** Access grant workflow (BE-ACCESSWF-001..009) */
  async createAccessGrantIntent({ callerDid, assetId, granteeDid, permissionMask, expiresAtSeconds, verified, requestDigest }) {
    const callerDidHash = computeDidHash(callerDid);
    const granteeDidHash = computeDidHash(granteeDid);

    await this.repo.identitiesRepo.requireActive(callerDidHash);
    await this.repo.identitiesRepo.requireActive(granteeDidHash);

    if (callerDidHash.toLowerCase() === granteeDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'self-grant forbidden');
    }

    const asset = await this.repo.getAsset(assetId);
    if (!asset || String(asset.status).toUpperCase() !== 'ACTIVE') {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found or inactive');
    }
    if (asset.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'caller is not current asset owner');
    }

    const mask = Number(permissionMask);
    // Allowed bits: READ=1, SHARE=8, VERIFY=16 (sum=25)
    if ((mask & 2) !== 0 || (mask & 4) !== 0 || mask <= 0) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'UPDATE and TRANSFER delegation forbidden in MVP');
    }

    const exp = BigInt(expiresAtSeconds ?? Math.floor(Date.now() / 1000) + 86400 * 30);
    const abi = this.chain.abis.AssetAccessRegistry;
    const args = [BigInt(assetId), granteeDidHash, BigInt(mask), exp];

    const intent = await this.stepUp.createPermitIntent({
      callerDid,
      contractAddress: this.chain.addressOf('assetAccessRegistry'),
      abi,
      functionName: 'grantAccess',
      args,
      kind: 'ACCESS',
      endpoint: `POST /assets/${assetId}/access-grant-intent`,
      requestDigest,
      verified,
    });

    return {
      operationId: intent.operationId,
      assetId: String(assetId),
      granteeDid,
      permissionMask: mask,
      expiresAt: Number(exp),
      calldata: intent.calldata,
      target: intent.target,
      permit: intent.permit,
    };
  }

  /** Access revoke workflow */
  async createAccessRevokeIntent({ callerDid, assetId, granteeDid, verified, requestDigest }) {
    const callerDidHash = computeDidHash(callerDid);
    const granteeDidHash = computeDidHash(granteeDid);

    await this.repo.identitiesRepo.requireActive(callerDidHash);
    const asset = await this.repo.getAsset(assetId);
    if (!asset || String(asset.status).toUpperCase() !== 'ACTIVE') {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found or inactive');
    }
    if (asset.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'caller is not current asset owner');
    }

    const abi = this.chain.abis.AssetAccessRegistry;
    const args = [BigInt(assetId), granteeDidHash];

    const intent = await this.stepUp.createPermitIntent({
      callerDid,
      contractAddress: this.chain.addressOf('assetAccessRegistry'),
      abi,
      functionName: 'revokeAccess',
      args,
      kind: 'ACCESS',
      endpoint: `POST /assets/${assetId}/access-revoke-intent`,
      requestDigest,
      verified,
    });

    return {
      operationId: intent.operationId,
      assetId: String(assetId),
      granteeDid,
      calldata: intent.calldata,
      target: intent.target,
      permit: intent.permit,
    };
  }

  /** Document update workflow */
  async createDocumentUpdateIntent({ callerDid, assetId, stagedId, expectedDocumentHash, verified, requestDigest }) {
    const callerDidHash = computeDidHash(callerDid);
    await this.repo.identitiesRepo.requireActive(callerDidHash);

    const asset = await this.repo.getAsset(assetId);
    if (!asset || String(asset.status).toUpperCase() !== 'ACTIVE') {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found or inactive');
    }
    if (asset.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'caller is not current asset owner');
    }

    const staged = await this.repo.getStaged(stagedId);
    if (!staged || staged.status !== 'STAGED') {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'staged document not found');
    }

    const chainRoot = await this.chain.getRoot(callerDidHash);
    const projection = await this.repo.activeLeaves(callerDidHash);
    if (projection.oldVersion !== chainRoot.version) {
      throw new DomainError(ErrorCode.STALE_ROOT, 'root projection stale');
    }

    const newDocHash = '0x' + staged.checksumSha256;
    const newMetaHash = '0x' + staged.checksumSha256.split('').reverse().join('');
    const newVersion = BigInt(asset.documentVersion) + 1n;

    const updatedLeaf = computeLeaf(BigInt(assetId), callerDidHash, newDocHash, newMetaHash, newVersion);
    const updatedLeaves = projection.leaves.map((l) => (l.assetId === BigInt(assetId) ? { assetId: l.assetId, leaf: updatedLeaf } : l));
    const nextRoot = rootOf(updatedLeaves.map((l) => l.leaf));

    const abi = this.chain.abis.AssetRegistry;
    const args = [
      BigInt(assetId),
      expectedDocumentHash ?? asset.documentHash,
      newDocHash,
      newMetaHash,
      '0x' + '0'.repeat(64),
      chainRoot.root,
      nextRoot,
      chainRoot.version,
    ];

    const intent = await this.stepUp.createPermitIntent({
      callerDid,
      contractAddress: this.chain.addressOf('assetRegistry'),
      abi,
      functionName: 'updateDocument',
      args,
      kind: 'UPDATE',
      endpoint: `POST /assets/${assetId}/document-update-intent`,
      requestDigest,
      verified,
    });

    return {
      operationId: intent.operationId,
      assetId: String(assetId),
      documentVersion: Number(newVersion),
      calldata: intent.calldata,
      target: intent.target,
      permit: intent.permit,
    };
  }

  /** Asset deactivation workflow */
  async createDeactivateIntent({ callerDid, assetId, verified, requestDigest }) {
    const callerDidHash = computeDidHash(callerDid);
    await this.repo.identitiesRepo.requireActive(callerDidHash);

    const asset = await this.repo.getAsset(assetId);
    if (!asset || String(asset.status).toUpperCase() !== 'ACTIVE') {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found or already inactive');
    }
    if (asset.ownerDidHash.toLowerCase() !== callerDidHash.toLowerCase()) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'caller is not current asset owner');
    }

    const chainRoot = await this.chain.getRoot(callerDidHash);
    const projection = await this.repo.activeLeaves(callerDidHash);
    if (projection.oldVersion !== chainRoot.version) {
      throw new DomainError(ErrorCode.STALE_ROOT, 'root projection stale');
    }

    const remaining = projection.leaves.filter((l) => l.assetId !== BigInt(assetId)).map((l) => l.leaf);
    const nextRoot = remaining.length === 0 ? EMPTY_ROOT : rootOf(remaining);

    const abi = this.chain.abis.AssetRegistry;
    const args = [BigInt(assetId), chainRoot.root, nextRoot, chainRoot.version];

    const intent = await this.stepUp.createPermitIntent({
      callerDid,
      contractAddress: this.chain.addressOf('assetRegistry'),
      abi,
      functionName: 'deactivateAsset',
      args,
      kind: 'DEACTIVATE',
      endpoint: `POST /assets/${assetId}/deactivate-intent`,
      requestDigest,
      verified,
    });

    return {
      operationId: intent.operationId,
      assetId: String(assetId),
      calldata: intent.calldata,
      target: intent.target,
      permit: intent.permit,
    };
  }

  /** BE-MINT-017 / BE-DOD-003: the ONLY path to CONFIRMED is a finalized event. */
  async finalizeChainEvent(event) {
    if (this.repo.isFinalized && this.repo.isFinalized(event.chainId, event.txHash, event.logIndex)) return;
    if (this.repo.markFinalized) this.repo.markFinalized(event.chainId, event.txHash, event.logIndex);

    const assetId = BigInt(event.assetId).toString();
    await this.repo.upsertAsset({
      assetId,
      ownerDidHash: event.ownerDidHash,
      status: 'ACTIVE',
      documentHash: event.documentHash,
      metadataHash: event.metadataHash,
      documentVersion: 1,
    });
    const { leaves, oldVersion } = await this.repo.activeLeaves(event.ownerDidHash);
    const newVersion = oldVersion + 1n;
    const leafHashes = leaves.map((l) => l.leaf);
    const newRoot = leafHashes.length === 0 ? EMPTY_ROOT : rootOf(leafHashes);
    await this.repo.setRoot(event.ownerDidHash, newRoot, newVersion);

    if (this.repo.merkleService) {
      try {
        const leafEntries = leaves.map((l, i) => ({
          assetId: l.assetId.toString(),
          leafHash: l.leaf,
          ordinal: i,
        }));
        await this.repo.merkleService.persistSnapshot(event.ownerDidHash, newVersion, leafEntries);
      } catch {
        // Snapshot already exists or handled by indexer
      }
    }
  }
}

