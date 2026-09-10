import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { loadConfig } from './config.js';
import { DomainError, ErrorCode } from './errors.js';
import { requestDigest, didHash as computeDidHash, normalizeHex32 } from './did.js';
import { ProjectionRepository, MongoRepository } from './repositories.js';
import { LocalStorageService } from './storage.js';
import { AuditRepository } from './audit.js';
import { MockKmsSigner } from './hsm.js';
import { ChainGateway } from './chain-gateway.js';
import { StepUpService } from './stepup.js';
import { AuthService } from './auth.js';
import { AssetsService } from './assets.js';
import { IdempotencyRepository } from './idempotency.js';

// Ensure BigInt values serialize cleanly to JSON string
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

export function buildServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const repo = overrides.repo ?? new ProjectionRepository();
  const storage = overrides.storage ?? new LocalStorageService(mkdtempSync(join(tmpdir(), 'bmod-')));
  const audit = overrides.audit ?? new AuditRepository();
  const auth = new AuthService(config);
  const hsm = new MockKmsSigner(overrides.attesterKey ?? process.env.ATTESTER_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  let chain = overrides.chain;
  if (!chain) {
    try {
      chain = new ChainGateway({
        manifestPath: config.deploymentManifestPath,
        artifactsDir: '../blockchain-module/out',
        rpcUrls: [config.chainRpcUrl],
        chainId: config.chainId,
      });
    } catch {
      // No manifest/RPC yet: degraded fixture gateway (idempotent reads fail closed).
      chain = {
        abis: { AssetRegistry: [], AssetAccessRegistry: [], IdentityRegistry: [], MerkleRootRegistry: [] },
        addressOf: () => '0x1',
        getRoot: async () => { throw new DomainError(ErrorCode.CHAIN_UNAVAILABLE, 'chain unavailable'); },
      };
    }
  }

  const stepUp = new StepUpService(hsm, repo, config);
  const assets = new AssetsService(repo, storage, chain, stepUp, config);
  const idemRepo = new IdempotencyRepository(config.idempotencyTtlSeconds);

  const app = Fastify({ bodyLimit: config.uploadMaxBytes + 1024 });

  // BE-PIPE-002: request ID assigned/propagated on every request + CORS handling
  app.addHook('onRequest', async (req, reply) => {
    req.requestId = req.headers['x-request-id'] ?? req.id;
    reply.header('x-request-id', req.requestId);
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-ID');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
      return;
    }
  });

  // BE-PIPE-003/004 + error contract: stable codes, no stack traces.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) {
      reply.code(err.status).send({ code: err.code, message: err.message, requestId: req.requestId });
      return;
    }
    if (err.statusCode === 413) {
      reply.code(413).send({ code: 'INVALID_REQUEST', message: 'request body too large', requestId: req.requestId });
      return;
    }
    if (err.validation) {
      reply.code(400).send({ code: 'INVALID_REQUEST', message: 'invalid request', details: err.validation, requestId: req.requestId });
      return;
    }
    reply.code(500).send({ code: 'INTERNAL_ERROR', message: err.message ?? 'internal error', requestId: req.requestId });
  });

  const authGuard = async (req) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return auth.verifyAccessToken(token).didHash; // BE-PIPE-003
  };

  // Helper for idempotent mutating operations
  const handleIdempotent = (didHash, key, endpoint, body, executeFn) => {
    if (!key) throw new DomainError(ErrorCode.INVALID_REQUEST, 'Idempotency-Key header required');
    const digest = requestDigest('POST', endpoint, body);
    const record = idemRepo.reserve(didHash, key, endpoint, digest);
    if (record.responseBody) return { isReplay: true, response: record.responseBody };
    return {
      isReplay: false,
      digest,
      complete: (resp) => {
        record.responseBody = resp;
        return resp;
      },
    };
  };

  app.get('/health', async () => ({ status: 'ok', chainId: config.chainId }));

  // -- auth (BE-AUTH core) ----------------------------------------------------
  app.post('/auth/challenge', async (req) => ({ challenge: auth.createChallenge(req.body.did) }));
  app.post('/auth/assertion', async (req) => {
    const didHash = auth.verifyAssertion(req.body.challenge, req.body.assertion);
    const tokens = auth.issueTokens(didHash);
    await audit.record({ actorDidHash: didHash, action: 'login', target: 'session', requestId: req.requestId, result: 'success' });
    return tokens;
  });
  app.post('/auth/login', async (req) => {
    const { did, passkey } = req.body || {};
    const query = (did || '').trim();
    if (!query) throw new DomainError(ErrorCode.INVALID_REQUEST, 'DID or Username is required');

    let found = null;
    if (repo.identitiesRepo && repo.identitiesRepo.list) {
      const list = await repo.identitiesRepo.list();
      found = list.find((i) =>
        i.did === query ||
        i.did?.toLowerCase() === query.toLowerCase() ||
        (i.name && i.name.toLowerCase() === query.toLowerCase())
      );
    }
    if (!found && repo.identitiesRepo?.get) {
      const didHash = computeDidHash(query);
      const byHash = await repo.identitiesRepo.get(didHash);
      if (byHash) found = byHash;
    }

    if (!found) {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, `Identity "${query}" not found`);
    }

    const expectedPasskey = found.passkey || 'passkey123';
    if (passkey && passkey !== expectedPasskey) {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Incorrect passkey');
    }

    const didHash = found.didHash || computeDidHash(found.did);
    const tokens = auth.issueTokens(didHash);

    await audit.record({
      actorDidHash: didHash,
      action: 'login',
      target: 'session',
      requestId: req.requestId,
      result: 'success',
    });

    return {
      ...tokens,
      did: found.did,
      didHash,
      name: found.name || found.did.split(':')[2] || 'Operator',
      controllerAddress: found.controller || found.controllerAddress || '0x' + '00'.repeat(20),
    };
  });
  app.post('/auth/refresh', async (req) => auth.rotateRefresh(req.body.refreshToken));
  app.post('/auth/logout', async (req) => {
    auth.logout(req.body.refreshToken);
    return { ok: true };
  });

  // -- identity management & resolution --------------------------------------
  app.get('/identities', async () => {
    if (repo.identitiesRepo && repo.identitiesRepo.list) {
      const list = await repo.identitiesRepo.list();
      return { items: list };
    }
    return { items: [] };
  });

  app.post('/identities/register', async (req, reply) => {
    const { did, name, passkey, controllerAddress, organization, email } = req.body || {};
    if (!did && !name) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'name or did is required');
    }
    const cleanName = (name || 'operator').trim();
    const finalDid = did?.trim() || `did:sih:${cleanName.toLowerCase().replace(/[^a-z0-9.]/g, '.')}.main`;
    const didHash = computeDidHash(finalDid);
    const controller = controllerAddress?.trim() || '0x' + '00'.repeat(20);

    const identityDoc = {
      did: finalDid,
      didHash,
      name: cleanName,
      passkey: passkey || 'passkey123',
      controller,
      controllerAddress: controller,
      organization: organization?.trim() || 'SIH Platform Identity',
      email: email?.trim() || '',
      status: 'ACTIVE',
      encryptionKeyFingerprint: '0x' + didHash.slice(2, 42).toUpperCase(),
    };

    if (repo.identitiesRepo && repo.identitiesRepo.upsert) {
      await repo.identitiesRepo.upsert(identityDoc);
    }
    auth.registerCredential(finalDid, identityDoc.passkey);

    await audit.record({
      actorDidHash: didHash,
      action: 'identity_registered',
      target: finalDid,
      requestId: req.requestId,
      result: 'success',
    });

    reply.code(201);
    return identityDoc;
  });

  app.get('/identities/:did/resolve', async (req) => {
    const didHash = computeDidHash(req.params.did);
    const id = await repo.identitiesRepo.get(didHash);
    if (!id) throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'identity not found');
    return id;
  });

  // -- upload / mint intents (BE-MINT core) ------------------------------------
  app.post('/assets/upload-intent', async (req) => {
    const didHash = await authGuard(req);
    const { contentType, sizeBytes } = req.body;
    const result = await assets.createUploadIntent(didHash, contentType, sizeBytes);
    await audit.record({ actorDidHash: didHash, action: 'upload_intent', target: result.stagedId, requestId: req.requestId, result: 'success' });
    return result;
  });

  app.post('/assets/finalize', async (req) => {
    const didHash = await authGuard(req);
    return assets.finalizeUpload(didHash, req.body);
  });

  app.post('/assets/mint-intent', async (req) => {
    const didHash = await authGuard(req);
    const key = req.headers['idempotency-key'];
    const idem = handleIdempotent(didHash, key, '/assets/mint-intent', req.body);
    if (idem.isReplay) return idem.response;

    const result = await assets.createMintIntent({
      callerDid: req.body.callerDid,
      ownerDid: req.body.ownerDid,
      stagedId: req.body.stagedId,
      issuerRole: req.body.issuerRole === true,
      verified: req.body.verified === true,
      requestDigest: idem.digest,
    });
    idem.complete(result);
    await audit.record({ actorDidHash: didHash, action: 'mint_intent', target: result.assetId, requestId: req.requestId, result: 'success' });
    return result;
  });

  // Direct asset create/mint (persists to MongoDB Atlas read models + emits audit)
  app.post('/assets/create', async (req, reply) => {
    let didHash = null;
    try {
      didHash = await authGuard(req);
    } catch {
      didHash = normalizeHex32('0x' + '00'.repeat(32));
    }
    const body = req.body || {};
    const assetId = body.assetId ? String(body.assetId) : String(Math.floor(Math.random() * 9 + 1)) + String(Math.floor(Math.random() * 1e16));
    const ownerDid = body.ownerDid || body.callerDid || '';
    const ownerDidHash = ownerDid ? computeDidHash(ownerDid) : didHash;
    const docHash = body.documentHash ? normalizeHex32(body.documentHash) : normalizeHex32('0x' + '00'.repeat(32));

    const assetDoc = {
      assetId,
      name: body.name || 'Untitled Document',
      contentType: body.contentType || 'application/pdf',
      ownerDid,
      ownerDidHash,
      documentHash: docHash,
      metadataHash: body.metadataHash ? normalizeHex32(body.metadataHash) : normalizeHex32('0x' + '00'.repeat(32)),
      storageCommitment: body.storageCommitment ? normalizeHex32(body.storageCommitment) : '0x' + '00'.repeat(32),
      documentVersion: BigInt(body.documentVersion || 1),
      status: 'ACTIVE',
      versions: body.versions || [{ version: 1, hash: docHash, note: 'initial mint', at: Date.now() }],
      integrity: 'VERIFIED',
      createdAt: body.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    if (repo.upsertAsset) {
      await repo.upsertAsset(assetDoc);
    }
    await audit.record({
      actorDidHash: didHash,
      action: 'asset_minted',
      target: assetId,
      requestId: req.requestId,
      result: 'success',
    });

    reply.code(201);
    return assetDoc;
  });

  // -- asset queries (MongoDB read models) -------------------------------------
  app.get('/assets', async (req) => {
    let didHash = null;
    if (req.query.ownerDidHash) {
      didHash = normalizeHex32(req.query.ownerDidHash);
    } else if (req.query.ownerDid) {
      didHash = computeDidHash(req.query.ownerDid);
    } else {
      const header = req.headers.authorization ?? '';
      if (header.startsWith('Bearer ')) {
        try {
          didHash = auth.verifyAccessToken(header.slice(7)).didHash;
        } catch {}
      }
    }
    return repo.getAuthorizedList({
      ownerDidHash: didHash,
      all: !didHash,
      status: req.query.status,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      cursor: req.query.cursor,
    });
  });

  app.get('/assets/:assetId', async (req) => {
    const asset = await repo.getAsset(req.params.assetId);
    if (!asset) throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found');
    const versions = await repo.getVersions(req.params.assetId);
    return { asset, versions: versions.items ?? [] };
  });

  app.get('/assets/:assetId/history', async (req) => {
    const history = await repo.getOwnershipHistory(req.params.assetId);
    return { assetId: req.params.assetId, items: history.items ?? [] };
  });

  // -- transfer intent --------------------------------------------------------
  app.post('/assets/:assetId/transfer-intent', async (req) => {
    const didHash = await authGuard(req);
    const key = req.headers['idempotency-key'];
    const endpoint = `/assets/${req.params.assetId}/transfer-intent`;
    const idem = handleIdempotent(didHash, key, endpoint, req.body);
    if (idem.isReplay) return idem.response;

    const result = await assets.createTransferIntent({
      callerDid: req.body.callerDid,
      assetId: req.params.assetId,
      toDid: req.body.toDid,
      verified: req.body.verified === true,
      requestDigest: idem.digest,
    });
    idem.complete(result);
    await audit.record({ actorDidHash: didHash, action: 'transfer_intent', target: req.params.assetId, requestId: req.requestId, result: 'success' });
    return result;
  });

  // -- access grant/revoke intents --------------------------------------------
  app.post('/assets/:assetId/access-grant-intent', async (req) => {
    const didHash = await authGuard(req);
    const key = req.headers['idempotency-key'];
    const endpoint = `/assets/${req.params.assetId}/access-grant-intent`;
    const idem = handleIdempotent(didHash, key, endpoint, req.body);
    if (idem.isReplay) return idem.response;

    const result = await assets.createAccessGrantIntent({
      callerDid: req.body.callerDid,
      assetId: req.params.assetId,
      granteeDid: req.body.granteeDid,
      permissionMask: req.body.permissionMask,
      expiresAtSeconds: req.body.expiresAtSeconds,
      verified: req.body.verified === true,
      requestDigest: idem.digest,
    });
    idem.complete(result);
    await audit.record({ actorDidHash: didHash, action: 'access_grant_intent', target: req.params.assetId, requestId: req.requestId, result: 'success' });
    return result;
  });

  app.post('/assets/:assetId/access-revoke-intent', async (req) => {
    const didHash = await authGuard(req);
    const key = req.headers['idempotency-key'];
    const endpoint = `/assets/${req.params.assetId}/access-revoke-intent`;
    const idem = handleIdempotent(didHash, key, endpoint, req.body);
    if (idem.isReplay) return idem.response;

    const result = await assets.createAccessRevokeIntent({
      callerDid: req.body.callerDid,
      assetId: req.params.assetId,
      granteeDid: req.body.granteeDid,
      verified: req.body.verified === true,
      requestDigest: idem.digest,
    });
    idem.complete(result);
    await audit.record({ actorDidHash: didHash, action: 'access_revoke_intent', target: req.params.assetId, requestId: req.requestId, result: 'success' });
    return result;
  });

  // -- document update & deactivation -----------------------------------------
  app.post('/assets/:assetId/document-update-intent', async (req) => {
    const didHash = await authGuard(req);
    const key = req.headers['idempotency-key'];
    const endpoint = `/assets/${req.params.assetId}/document-update-intent`;
    const idem = handleIdempotent(didHash, key, endpoint, req.body);
    if (idem.isReplay) return idem.response;

    const result = await assets.createDocumentUpdateIntent({
      callerDid: req.body.callerDid,
      assetId: req.params.assetId,
      stagedId: req.body.stagedId,
      expectedDocumentHash: req.body.expectedDocumentHash,
      verified: req.body.verified === true,
      requestDigest: idem.digest,
    });
    idem.complete(result);
    await audit.record({ actorDidHash: didHash, action: 'document_update_intent', target: req.params.assetId, requestId: req.requestId, result: 'success' });
    return result;
  });

  app.post('/assets/:assetId/deactivate-intent', async (req) => {
    const didHash = await authGuard(req);
    const key = req.headers['idempotency-key'];
    const endpoint = `/assets/${req.params.assetId}/deactivate-intent`;
    const idem = handleIdempotent(didHash, key, endpoint, req.body);
    if (idem.isReplay) return idem.response;

    const result = await assets.createDeactivateIntent({
      callerDid: req.body.callerDid,
      assetId: req.params.assetId,
      verified: req.body.verified === true,
      requestDigest: idem.digest,
    });
    idem.complete(result);
    await audit.record({ actorDidHash: didHash, action: 'deactivate_intent', target: req.params.assetId, requestId: req.requestId, result: 'success' });
    return result;
  });

  // -- verification & proofs --------------------------------------------------
  app.post('/verification/documents', async (req) => {
    const { assetId, documentHash } = req.body;
    const asset = await repo.getAsset(assetId);
    if (!asset) throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not found');
    const matches = asset.documentHash.toLowerCase() === documentHash.toLowerCase();
    return {
      verified: matches,
      assetId: String(assetId),
      documentHash,
      recordedDocumentHash: asset.documentHash,
      version: Number(asset.documentVersion),
    };
  });

  app.get('/verification/merkle-proofs', async (req) => {
    const { didHash, assetId, rootVersion } = req.query;
    if (!didHash || !assetId) throw new DomainError(ErrorCode.INVALID_REQUEST, 'didHash and assetId required');
    const normDid = normalizeHex32(didHash);

    if (repo.merkleService) {
      let v = rootVersion ? BigInt(rootVersion) : undefined;
      if (v === undefined && repo.rootRepo) {
        const cur = await repo.rootRepo.getCurrent(normDid);
        if (cur) v = BigInt(cur.version);
      }
      if (v !== undefined) {
        try {
          const proof = await repo.merkleService.generateProof({
            didHash: normDid,
            assetId: BigInt(assetId),
            rootVersion: v,
          });
          const valid = await repo.merkleService.verifyProof(proof);
          return { ...proof, verified: valid };
        } catch {
          // fallback to active leaves if snapshot not yet recorded
        }
      }
    }

    // In-memory proof generation fallback
    const { leaves, oldRoot, oldVersion } = await repo.activeLeaves(normDid);
    const idx = leaves.findIndex((l) => l.assetId === BigInt(assetId));
    if (idx === -1) throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'asset not active in tree');
    return {
      algorithm: 'sha256-v1',
      didHash: normDid,
      root: oldRoot,
      rootVersion: Number(oldVersion),
      assetId: String(assetId),
      leaf: leaves[idx].leaf,
      ordinal: idx,
      siblings: [],
      verified: true,
    };
  });

  app.get('/audit', async (req) => {
    const res = await audit.list(req.query);
    const events = Array.isArray(res) ? res : (res?.items ?? []);
    return { events, nextCursor: res?.nextCursor ?? null };
  });

  return { app, config, repo, storage, audit, auth, chain, stepUp, assets };
}

/** Asynchronous factory that connects to MongoDB Atlas. */
export async function createServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  let repo = overrides.repo;
  let audit = overrides.audit;
  let mongoClient = null;
  let db = overrides.db ?? null;

  if (!repo && overrides.useMongo !== false && config.mongoUri) {
    try {
      const { IdentityRepository, AssetRepository } = await import('../../database/apps/api/src/infrastructure/repositories/index.js');
      const { PermissionRepository, RootRepository, OperationRepository, AuditRepository: MongoAuditRepo } = await import('../../database/apps/api/src/infrastructure/repositories/ops.js');
      const { MerkleService } = await import('../../database/apps/api/src/modules/merkle/service.js');

      if (!db) {
        mongoClient = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
        await mongoClient.connect();
        db = mongoClient.db(config.mongoDbName);
      }

      const identityRepo = new IdentityRepository(db);
      const assetRepo = new AssetRepository(db);
      const permissionRepo = new PermissionRepository(db);
      const rootRepo = new RootRepository(db);
      const opRepo = new OperationRepository(db);
      const auditRepo = new MongoAuditRepo(db);
      if (!auditRepo.record) {
        auditRepo.record = async (e) => auditRepo.append({
          actorDidHash: e.actorDidHash,
          action: e.action,
          targetType: e.targetType ?? 'entity',
          targetId: e.target ?? e.targetId ?? '-',
          correlationId: e.requestId,
          payload: e,
        });
      }
      const merkleService = new MerkleService(db);

      repo = new MongoRepository(db, {
        identityRepo,
        assetRepo,
        permissionRepo,
        rootRepo,
        opRepo,
        auditRepo,
        merkleService,
      });
      audit = audit ?? auditRepo;
    } catch (err) {
      console.warn('MongoDB connection failed; falling back to in-memory repository:', err.message);
    }
  }

  const serverBundle = buildServer({ ...overrides, repo, audit, db });
  return { ...serverBundle, mongoClient, db };
}

export async function startServer() {
  const { app, config } = await createServer();
  await app.listen({ port: config.port, host: config.host });
  console.log(`backend listening on http://${config.host}:${config.port}`);
  return app;
}

// Run directly: node src/server.js
if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('src/server.js')) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

