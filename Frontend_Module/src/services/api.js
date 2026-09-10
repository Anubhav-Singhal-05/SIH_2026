// Real API service layer interfacing with the backend Fastify server and MongoDB Atlas
export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

let currentToken = null

export const setAuthToken = (token) => {
  currentToken = token
}

export const getAuthToken = () => currentToken

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'req-' + Math.random().toString(36).substring(2, 15)
}

async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {}),
  }

  if (currentToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${currentToken}`
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.body)
  }

  if (['POST', 'PUT', 'PATCH'].includes(options.method?.toUpperCase()) && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = generateUUID()
  }

  try {
    const res = await fetch(url, { ...options, headers })
    if (res.status === 204) return { ok: true }

    const contentType = res.headers.get('content-type') || ''
    const data = contentType.includes('application/json') ? await res.json() : await res.text()

    if (!res.ok) {
      const msg = (typeof data === 'object' && data.message) ? data.message : res.statusText
      const err = new Error(msg || 'API Request Failed')
      err.status = res.status
      err.code = (typeof data === 'object' && data.code) || 'API_ERROR'
      throw err
    }
    return data
  } catch (err) {
    console.warn(`[API] Error on ${options.method || 'GET'} ${endpoint}:`, err.message)
    throw err
  }
}

export const api = {
  // System
  healthCheck: () => request('/health'),

  // Auth & Identity
  registerIdentity: (payload) => request('/identities/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  fetchIdentities: () => request('/identities'),
  resolveIdentity: (did) => request(`/identities/${encodeURIComponent(did)}/resolve`),
  logout: (refreshToken) => request('/auth/logout', { method: 'POST', body: { refreshToken } }),

  // Assets
  fetchAssets: (ownerDid) => {
    const query = ownerDid ? `?ownerDid=${encodeURIComponent(ownerDid)}` : ''
    return request(`/assets${query}`)
  },
  fetchAssetById: (assetId) => request(`/assets/${encodeURIComponent(assetId)}`),
  createAsset: (payload) => request('/assets/create', { method: 'POST', body: payload }),
  createUploadIntent: (payload) => request('/assets/upload-intent', { method: 'POST', body: payload }),
  finalizeUpload: (payload) => request('/assets/finalize', { method: 'POST', body: payload }),
  createMintIntent: (payload) => request('/assets/mint-intent', { method: 'POST', body: payload }),
  createTransferIntent: (assetId, payload) => request(`/assets/${encodeURIComponent(assetId)}/transfer-intent`, { method: 'POST', body: payload }),
  createAccessGrantIntent: (assetId, payload) => request(`/assets/${encodeURIComponent(assetId)}/access-grant-intent`, { method: 'POST', body: payload }),
  createAccessRevokeIntent: (assetId, payload) => request(`/assets/${encodeURIComponent(assetId)}/access-revoke-intent`, { method: 'POST', body: payload }),
  createDocumentUpdateIntent: (assetId, payload) => request(`/assets/${encodeURIComponent(assetId)}/document-update-intent`, { method: 'POST', body: payload }),
  createDeactivateIntent: (assetId, payload) => request(`/assets/${encodeURIComponent(assetId)}/deactivate-intent`, { method: 'POST', body: payload }),

  // Audit
  fetchAuditLogs: (query = '') => request(`/audit${query}`),

  // Verification
  verifyDocument: (payload) => request('/verification/documents', { method: 'POST', body: payload }),
  fetchMerkleProof: (didHash, assetId, rootVersion) => {
    let q = `?didHash=${encodeURIComponent(didHash)}&assetId=${encodeURIComponent(assetId)}`
    if (rootVersion) q += `&rootVersion=${rootVersion}`
    return request(`/verification/merkle-proofs${q}`)
  },
}
