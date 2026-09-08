import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError, ErrorCode } from './errors.js';
import { didHash as computeDidHash } from './did.js';

/**
 * WebAuthn session service (BE-AUTH-001..013, 019 core). Challenge lifecycle,
 * token rotation, and family revocation follow backend_team_spec.md §3. The
 * credential registry is a fixture for the database team's table.
 */
export class AuthService {
  constructor(config) {
    this.config = config;
    this.challenges = new Map();
    this.credentials = new Map();
    this.sessions = new Map(); // refreshHash -> record
  }

  /** Cryptographically random, single-use, expiring challenge (BE-AUTH-001/002). */
  createChallenge(did) {
    const didHash = computeDidHash(did);
    const challenge = randomBytes(32).toString('base64url');
    this.challenges.set(challenge, { challenge, didHash, expiresAt: Date.now() + 60_000, used: false });
    return challenge;
  }

  consumeChallenge(challenge) {
    const rec = this.challenges.get(challenge);
    if (!rec || rec.used || rec.expiresAt <= Date.now()) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'invalid or expired challenge');
    }
    rec.used = true;
    return rec;
  }

  registerCredential(did, credentialId) {
    this.credentials.set(credentialId, { didHash: computeDidHash(did), counter: 0 });
  }

  /** Monotonic-counter assertion verification; generic errors (BE-AUTH-006/007/017). */
  verifyAssertion(challenge, assertion) {
    const rec = this.consumeChallenge(challenge);
    const cred = this.credentials.get(assertion.credentialId);
    if (!cred || cred.didHash !== rec.didHash || !assertion.signatureOk) {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    }
    if (assertion.counter <= cred.counter) {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    }
    cred.counter = assertion.counter;
    return cred.didHash;
  }

  // -- tokens (BE-AUTH-009..013) ------------------------------------------
  issueTokens(didHash, familyId) {
    const fid = familyId ?? randomUUID();
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshHash = this.#hashRefresh(refreshToken);
    const now = Date.now();
    // Family lifetime is measured from the family's ORIGINAL creation,
    // regardless of later revocations (BE-AUTH-012).
    const family = [...this.sessions.values()].filter((s) => s.familyId === fid);
    const createdAt = family.length ? Math.min(...family.map((s) => s.createdAt)) : now;
    const familyExpiry = createdAt + this.config.sessionFamilyTtlSeconds * 1000;
    if (now >= familyExpiry) {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'session family lifetime exceeded');
    }
    this.sessions.set(refreshHash, {
      didHash,
      familyId: fid,
      refreshHash,
      createdAt,
      expiresAt: familyExpiry,
      revoked: false,
    });
    return { accessToken: this.#signAccessToken(didHash), refreshToken, expiresIn: this.config.accessTokenTtlSeconds };
  }

  /** Refresh rotation: reuse of a rotated token revokes the whole family. */
  rotateRefresh(refreshToken) {
    const refreshHash = this.#hashRefresh(refreshToken);
    const record = this.sessions.get(refreshHash);
    if (!record) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    if (record.revoked) {
      for (const s of this.sessions.values()) {
        if (s.familyId === record.familyId) s.revoked = true;
      }
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    }
    record.revoked = true; // BE-AUTH-011
    return this.issueTokens(record.didHash, record.familyId);
  }

  verifyAccessToken(token) {
    const parts = String(token).split('.');
    if (parts.length !== 2) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    const [payloadB64, sig] = parts;
    const expected = createHmac('sha256', this.config.rpId).update(payloadB64).digest('base64url');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp <= Date.now()) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'authentication failed');
    return { didHash: payload.sub };
  }

  logout(refreshToken) {
    const record = this.sessions.get(this.#hashRefresh(refreshToken));
    if (record) record.revoked = true; // BE-AUTH-019
  }

  #hashRefresh(refreshToken) {
    return createHmac('sha256', this.config.rpId).update(refreshToken).digest('hex');
  }

  #signAccessToken(didHash) {
    const payload = Buffer.from(
      JSON.stringify({ sub: didHash, exp: Date.now() + this.config.accessTokenTtlSeconds * 1000 }),
    ).toString('base64url');
    const sig = createHmac('sha256', this.config.rpId).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }
}
