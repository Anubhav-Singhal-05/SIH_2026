import { makeFixture, test, assert, ErrorCode, didHash, ALICE_DID } from './helpers.js';

test('BE-AUTH-001/002: challenge is single-use', () => {
  const f = makeFixtureSync();
  const ch = f.auth.createChallenge(ALICE_DID);
  f.auth.registerCredential(ALICE_DID, 'cred-1');
  assert.equal(f.auth.verifyAssertion(ch, { credentialId: 'cred-1', signatureOk: true, counter: 1 }), didHash(ALICE_DID));
  assert.throws(() => f.auth.verifyAssertion(ch, { credentialId: 'cred-1', signatureOk: true, counter: 2 }));
});

test('BE-AUTH-008: expired challenge cannot be consumed', () => {
  const f = makeFixtureSync();
  const ch = f.auth.createChallenge(ALICE_DID);
  f.auth.challenges.get(ch).expiresAt = Date.now() - 1;
  assert.throws(() => f.auth.consumeChallenge(ch));
});

test('BE-AUTH-006/017: generic error, no credential enumeration', () => {
  const f = makeFixtureSync();
  const ch = f.auth.createChallenge(ALICE_DID);
  assert.throws(
    () => f.auth.verifyAssertion(ch, { credentialId: 'ghost', signatureOk: true, counter: 1 }),
    (err) => err.code === ErrorCode.UNAUTHENTICATED && err.message === 'authentication failed',
  );
});

test('BE-AUTH-007: counter regression detected (cloned authenticator)', () => {
  const f = makeFixtureSync();
  f.auth.registerCredential(ALICE_DID, 'cred-2');
  const ch1 = f.auth.createChallenge(ALICE_DID);
  f.auth.verifyAssertion(ch1, { credentialId: 'cred-2', signatureOk: true, counter: 5 });
  const ch2 = f.auth.createChallenge(ALICE_DID);
  assert.throws(() => f.auth.verifyAssertion(ch2, { credentialId: 'cred-2', signatureOk: true, counter: 4 }));
  assert.throws(() => f.auth.verifyAssertion(ch2, { credentialId: 'cred-2', signatureOk: true, counter: 5 }));
});

test('BE-AUTH-010/011: 15-min access token; refresh rotates, old becomes invalid', () => {
  const f = makeFixtureSync();
  const alice = didHash(ALICE_DID);
  const tokens = f.auth.issueTokens(alice);
  assert.equal(f.auth.verifyAccessToken(tokens.accessToken).didHash, alice);
  assert.equal(tokens.expiresIn, 900);
  const rotated = f.auth.rotateRefresh(tokens.refreshToken);
  assert.throws(() => f.auth.rotateRefresh(tokens.refreshToken));
  assert.equal(f.auth.verifyAccessToken(rotated.accessToken).didHash, alice);
});

test('BE-AUTH-013: stale refresh reuse revokes the entire family', () => {
  const f = makeFixtureSync();
  const alice = didHash(ALICE_DID);
  const t1 = f.auth.issueTokens(alice);
  const t2 = f.auth.rotateRefresh(t1.refreshToken); // t1 now stale
  const t3 = f.auth.rotateRefresh(t2.refreshToken);
  assert.throws(() => f.auth.rotateRefresh(t1.refreshToken)); // reuse detected
  assert.throws(() => f.auth.rotateRefresh(t3.refreshToken)); // whole family revoked
});

test('BE-AUTH-019: logout invalidates refresh token', () => {
  const f = makeFixtureSync();
  const tokens = f.auth.issueTokens(didHash(ALICE_DID));
  f.auth.logout(tokens.refreshToken);
  assert.throws(() => f.auth.rotateRefresh(tokens.refreshToken));
});

test('BE-AUTH-009: tampered access token is rejected', () => {
  const f = makeFixtureSync();
  const tokens = f.auth.issueTokens(didHash(ALICE_DID));
  const tampered = tokens.accessToken.slice(0, -2) + 'xx';
  assert.throws(() => f.auth.verifyAccessToken(tampered));
});

test('BE-AUTH-012: session family never exceeds its 7-day maximum lifetime', () => {
  const f = makeFixtureSync();
  const t1 = f.auth.issueTokens(didHash(ALICE_DID));
  for (const s of f.auth.sessions.values()) {
    s.createdAt = Date.now() - (f.config.sessionFamilyTtlSeconds + 60) * 1000;
  }
  assert.throws(() => f.auth.rotateRefresh(t1.refreshToken));
});

import { AuthService } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

function makeFixtureSync() {
  const config = { ...loadConfig(), chainId: 31337 };
  return { auth: new AuthService(config), config };
}
