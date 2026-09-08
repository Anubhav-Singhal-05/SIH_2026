// Mock service layer. Mirrors the backend OpenAPI contract so calls can be
// swapped for real HTTP later. Every function resolves/rejects after an
// artificial 300-1500ms latency. No network is touched.
export const PCT = String.fromCharCode(37)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const rndDelay = () => sleep(300 + Math.floor(Math.random() * 1200))

const HEXC = '0123456789abcdef'
export const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += HEXC[Math.floor(Math.random() * 16)]; return s }
export const hex64 = () => '0x' + hex(64)
export const hex32 = () => '0x' + hex(64)
export const assetId = () => { let s = String(Math.floor(Math.random() * 9) + 1); for (let i = 0; i < 37; i++) s += String(Math.floor(Math.random() * 10)); return s }
export const uuid = () => { const s = (n) => hex(n); return s(8) + '-' + s(4) + '-4' + s(3) + '-a' + s(3) + '-' + s(12) }
export const shortHash = (h, a = 10, b = 6) => (h || '').slice(0, a) + '...' + (h || '').slice(-b)
export const now = () => Date.now()
export const fmtTime = (t) => {
  if (!t) return '-'
  try {
    const d = new Date(t)
    return isNaN(d.getTime()) ? '-' : d.toISOString().replace('T', ' ').slice(0, 19)
  } catch {
    return '-'
  }
}

// Stable error codes + operator-honest copy (mirrors backend ErrorResponse).
export const ERROR_COPY = {
  UNAUTHENTICATED: 'Session missing or expired. Re-authenticate with your passkey to continue.',
  FORBIDDEN: 'Your DID does not hold the role required for this action. Ownership or issuer role check failed on-chain.',
  INVALID_REQUEST: 'The request was rejected by validation policy. Check the submitted fields and try again.',
  IDEMPOTENCY_CONFLICT: 'This idempotency key was already used with a different request body. A new key was generated; retry the operation.',
  STALE_ROOT: 'The Merkle root moved while you were working. Your operation referenced a previous root version and was rejected.',
  PERMIT_EXPIRED: 'The step-up permit expired before it was used (60s TTL). Verify again to obtain a fresh permit.',
  WRONG_NETWORK: 'The connected wallet is on a different chain than the registry. Switch to chain 31337 and retry.',
  CHAIN_UNAVAILABLE: 'All chain providers are unreachable. Operations are queued locally; nothing was signed or submitted.',
  CONTRACT_REVERTED: 'The registry contract reverted the call. Inspect the revert reason before retrying.',
  STORAGE_FINALIZATION_FAILED: 'Ciphertext checksum or byte count did not match at finalization. Re-upload the document.',
  DOCUMENT_NOT_READY: 'The referenced staged document is unknown or was never finalized. Re-run the upload step.',
  REORG_IN_PROGRESS: 'A chain reorganization is in progress. Confirmation status is being re-evaluated.',
  RATE_LIMITED: 'Too many requests from this session. The operation was not submitted. Retry after the backoff window.',
  INTERNAL_ERROR: 'An unexpected server fault occurred. The operation state is preserved; contact operations support.',
}

// Mock API surface — same shapes as the OpenAPI spec.
export const api = {
  async createAuthChallenge(did) { await rndDelay(); return { challenge: hex(43) } },
  async verifyAssertion(challenge, assertion) {
    await rndDelay()
    if (!assertion || assertion.signatureOk === false) { const e = new Error('assertion rejected'); e.code = 'UNAUTHENTICATED'; throw e }
    return { accessToken: hex(32), refreshToken: hex(48), expiresIn: 900 }
  },
  async createUploadIntent({ contentType, sizeBytes }) {
    await rndDelay()
    const stagedId = uuid()
    return { stagedId, uploadUrl: 'mock://scoped-upload/' + stagedId, objectKey: 'obj/' + hex(24), expiresAt: new Date(now() + 900000).toISOString() }
  },
  async finalizeUpload({ stagedId, expectedChecksumSha256, expectedByteSize }) {
    await rndDelay()
    return { stagedId, status: 'STAGED' }
  },
  async createMintIntent({ callerDid, ownerDid, stagedId, verified, rootVersion }) {
    await rndDelay()
    return {
      operationId: uuid(),
      assetId: assetId(),
      calldata: '0x' + (verified ? hex(256) : ''),
      target: '0x7A1f' + hex(38),
      permit: { operationHash: hex64(), didHash: hex64(), expiresAt: now() + 60000, nonce: Math.floor(Math.random() * 100000), signature: verified ? '0x' + hex(128) : '' },
      rootVersion,
    }
  },
  async listAuditEvents(filter = {}) { await rndDelay(); return { events: [] } },
}