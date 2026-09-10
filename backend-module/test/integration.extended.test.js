import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

test('Integration: Identity registration, login, asset create and CORS', async (t) => {
  const { app, mongoClient } = await createServer();
  t.after(async () => {
    if (mongoClient) await mongoClient.close();
    await app.close();
  });

  // 1. CORS Preflight
  const corsRes = await app.inject({
    method: 'OPTIONS',
    url: '/identities/register',
  });
  assert.equal(corsRes.statusCode, 204);
  assert.equal(corsRes.headers['access-control-allow-origin'], '*');

  // 2. Register Identity
  const testDid = 'did:sih:test.' + Date.now();
  const regRes = await app.inject({
    method: 'POST',
    url: '/identities/register',
    payload: {
      did: testDid,
      name: 'Test Operator',
      passkey: 'secret123',
      controllerAddress: '0x1111111111111111111111111111111111111111',
      organization: 'SIH Test Org',
      email: 'test@example.com',
    },
  });
  assert.equal(regRes.statusCode, 201);
  const regBody = JSON.parse(regRes.body);
  assert.equal(regBody.did, testDid);
  assert.equal(regBody.status, 'ACTIVE');

  // 3. List Identities
  const listRes = await app.inject({
    method: 'GET',
    url: '/identities',
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = JSON.parse(listRes.body);
  assert.ok(listBody.items.some((i) => i.did === testDid));

  // 4. Login with passkey
  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      did: testDid,
      passkey: 'secret123',
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const loginBody = JSON.parse(loginRes.body);
  assert.ok(loginBody.accessToken);
  assert.equal(loginBody.did, testDid);

  // 5. Create Asset
  const assetRes = await app.inject({
    method: 'POST',
    url: '/assets/create',
    headers: {
      authorization: 'Bearer ' + loginBody.accessToken,
    },
    payload: {
      name: 'Test Contract.pdf',
      contentType: 'application/pdf',
      ownerDid: testDid,
      documentHash: '0x' + '11'.repeat(32),
      documentVersion: 1,
    },
  });
  assert.equal(assetRes.statusCode, 201);
  const assetBody = JSON.parse(assetRes.body);
  assert.equal(assetBody.name, 'Test Contract.pdf');

  // 6. Query Assets
  const queryRes = await app.inject({
    method: 'GET',
    url: '/assets?ownerDid=' + encodeURIComponent(testDid),
    headers: {
      authorization: 'Bearer ' + loginBody.accessToken,
    },
  });
  assert.equal(queryRes.statusCode, 200);
  const queryBody = JSON.parse(queryRes.body);
  assert.ok(queryBody.items.some((a) => a.name === 'Test Contract.pdf'));
});
