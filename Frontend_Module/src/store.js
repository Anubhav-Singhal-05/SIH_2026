import { create } from 'zustand'
import { identities as seedIdentities, assets as seedAssets, grants as seedGrants, inheritanceRule as seedRule, audits as seedAudits, SELF_DID } from './mock/fixtures'
import { uuid, hex64, now, ERROR_COPY, hex } from './mock/api'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const STEP_ORDER = ['STAGED','AWAITING_STEP_UP','AWAITING_SIGNATURE','SUBMITTED','CONFIRMED']

export const useStore = create((set, get) => {
  const setOp = (id, patch) => set((s) => ({ opsById: { ...s.opsById, [id]: { ...s.opsById[id], ...patch } } }))
  const pushOpStep = (id, step) => set((s) => {
    const op = s.opsById[id]
    return { opsById: { ...s.opsById, [id]: { ...op, currentStep: step, updatedAt: now(), trail: [...op.trail, { step, at: now() }] } } }
  })
  const addAudit = (a) => set((s) => ({ audits: [{ id: uuid(), actorDidHash: hex64(), requestId: 'req-' + hex(12), operationId: a.operationId || null, at: now(), result: a.result || 'success', target: a.target || '-', action: a.action, ...a }, ...s.audits] }))
  return {

    // ---- session ----
    session: null,
    login: async (did) => { await sleep(900); set({ session: { did: did || SELF_DID, accessToken: hex(32), loginAt: now() } }) },
    logout: () => set({ session: null }),
    registerDid: async ({ name }) => {
      await sleep(1100)
      const did = 'did:platform:' + name.toLowerCase().replace(/[^a-z0-9.]/g, '.') + '.main'
      const id = { did, controllerAddress: '0x' + hex(40), encryptionKeyFingerprint: '0x' + hex(20).toUpperCase(), status: 'ACTIVE', rootVersion: 1, rootHistory: [{ version: 1, rootHash: hex64(), at: now(), action: 'genesis' }] }
      set((s) => ({ identities: [id, ...s.identities] }))
      return id
    },

    // ---- entities ----
    identities: seedIdentities,
    assets: seedAssets,
    grants: seedGrants,
    inheritance: { ...seedRule },
    audits: seedAudits,
    addAsset: (a) => set((s) => ({ assets: [a, ...s.assets] })),
    patchAsset: (assetId, patch) => set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, ...patch, updatedAt: now() } : a)) })),
    bumpRoot: (did, action) => set((s) => ({ identities: s.identities.map((i) => (i.did === did ? { ...i, rootVersion: i.rootVersion + 1, rootHistory: [{ version: i.rootVersion + 1, rootHash: hex64(), at: now(), action }, ...i.rootHistory] } : i)) })),
    setIdentityStatus: (did, status) => set((s) => ({ identities: s.identities.map((i) => (i.did === did ? { ...i, status } : i)) })),
    rotateController: (did) => set((s) => ({ identities: s.identities.map((i) => (i.did === did ? { ...i, controllerAddress: '0x' + hex(40) } : i)) })),
    addGrant: (gr) => set((s) => ({ grants: [gr, ...s.grants] })),
    revokeGrant: (gid) => set((s) => ({ grants: s.grants.map((g) => (g.id === gid ? { ...g, status: 'REVOKED' } : g)) })),
    patchInheritance: (patch) => set((s) => ({ inheritance: { ...s.inheritance, ...patch } })),

    // ---- operations lifecycle (timer-driven, honest staged progression) ----
    opsById: {},
    opOrder: [],
    startOperation: ({ type, label, relatedId, payload }) => {
      const id = uuid()
      set((s) => ({ opsById: { ...s.opsById, [id]: { id, type, label, relatedId: relatedId || null, payload: payload || null, currentStep: 'STAGED', createdAt: now(), updatedAt: now(), trail: [{ step: 'STAGED', at: now() }], result: null, failCode: null } }, opOrder: [id, ...s.opOrder] }))
      return id
    },
    opAwaitStepUp: (id) => pushOpStep(id, 'AWAITING_STEP_UP'),
    opAwaitSignature: (id) => pushOpStep(id, 'AWAITING_SIGNATURE'),
    opSubmit: (id) => {
      pushOpStep(id, 'SUBMITTED')
      const latency = 2200 + Math.floor(Math.random() * 2600)
      setTimeout(() => {
        const op = get().opsById[id]
        if (!op) return
        const injected = get().injectNext
        const outcome = injected ? injected : (Math.random() < 0.08 ? 'REORGED' : 'CONFIRMED')
        if (outcome === 'CONFIRMED') {
          pushOpStep(id, 'CONFIRMED')
          setOp(id, { result: 'success' })
          addAudit({ action: op.type + '_confirmed', target: op.relatedId || op.label, operationId: id, result: 'success' })
          get().applySideEffects(op)
        } else if (outcome === 'REORGED') {
          pushOpStep(id, 'REORGED')
          setOp(id, { result: 'reorged' })
          addAudit({ action: op.type + '_reorged', target: op.relatedId || op.label, operationId: id, result: 'failure' })
          set({ reorg: { visible: true, opId: id } })
        } else {
          pushOpStep(id, 'FAILED')
          setOp(id, { result: 'failure', failCode: outcome })
          addAudit({ action: op.type + '_failed', target: op.relatedId || op.label, operationId: id, result: 'failure' })
          get().pushError(outcome)
        }
        set({ injectNext: null })
      }, latency)
    },

    applySideEffects: (op) => {
      const s = get()
      if (op.type === 'mint' && op.payload) { s.addAsset(op.payload); s.bumpRoot(s.session.did, 'asset_minted') }
      if (op.type === 'update' && op.relatedId) {
        const a = s.assets.find((x) => x.assetId === op.relatedId)
        if (a) {
          const nv = a.documentVersion + 1
          s.patchAsset(op.relatedId, { documentVersion: nv, documentHash: op.payload.hash, versions: [...a.versions, { version: nv, hash: op.payload.hash, note: op.payload.note, at: now() }], integrity: 'VERIFIED' })
          s.bumpRoot(s.session.did, 'document_updated')
        }
      }
      if (op.type === 'transfer' && op.relatedId && op.payload) { s.patchAsset(op.relatedId, { ownerDid: op.payload.to }); s.bumpRoot(op.payload.from, 'asset_transferred'); s.bumpRoot(op.payload.to, 'asset_transferred') }
      if (op.type === 'grant' && op.payload) { s.addGrant(op.payload); s.bumpRoot(s.session.did, 'access_granted') }
      if (op.type === 'revoke' && op.payload) { s.revokeGrant(op.payload); s.bumpRoot(s.session.did, 'access_revoked') }
      if (op.type === 'rotate') { s.rotateController(s.session.did); s.bumpRoot(s.session.did, 'controller_rotated') }
      if (op.type === 'suspend') { s.setIdentityStatus(s.session.did, 'SUSPENDED'); s.bumpRoot(s.session.did, 'identity_suspended') }
      if (op.type === 'deactivate') { s.setIdentityStatus(s.session.did, 'DEACTIVATED'); s.bumpRoot(s.session.did, 'identity_deactivated') }
      if (op.type === 'inheritance_config' && op.payload) { s.patchInheritance(op.payload); s.bumpRoot(s.session.did, 'inheritance_configured') }
      if (op.type === 'inheritance_activate') { s.patchInheritance({ status: 'ACTIVE', activatedAt: now() }); s.bumpRoot(s.session.did, 'inheritance_activated') }
      if (op.type === 'asset_deactivate' && op.relatedId) { s.patchAsset(op.relatedId, { status: 'DEACTIVATED' }); s.bumpRoot(s.session.did, 'asset_deactivated') }
    },
    // ---- errors / reorg / demo toggles ----
    errors: [],
    injectNext: null,
    reorg: { visible: false, opId: null },
    opsOpen: false,
    pushError: (code) => {
      const eid = uuid()
      set((s) => ({ errors: [...s.errors, { id: eid, code, requestId: 'req-' + hex(12) }] }))
      setTimeout(() => get().dismissError(eid), 8000)
    },
    dismissError: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
    setInjectNext: (code) => set({ injectNext: code }),
    triggerReorg: () => {
      const s = get()
      const confirmed = s.opOrder.map((id) => s.opsById[id]).find((o) => o.currentStep === 'CONFIRMED')
      if (confirmed) { pushOpStep(confirmed.id, 'REORGED'); setOp(confirmed.id, { result: 'reorged' }); addAudit({ action: 'chain_reorg', target: confirmed.relatedId || confirmed.label, result: 'failure' }) }
      set({ reorg: { visible: true, opId: confirmed ? confirmed.id : null } })
    },
    dismissReorg: () => set((s) => ({ reorg: { ...s.reorg, visible: false } })),
    setOpsOpen: (v) => set({ opsOpen: v }),
    errorCopy: ERROR_COPY,
  }
})

// Fine-grained selectors: op ticks only re-render the component showing that op.
export const useOp = (id) => useStore((s) => (id ? s.opsById[id] : null))
export const useActiveOps = () => useStore((s) => s.opOrder.map((id) => s.opsById[id]).filter((o) => o && !o.result))
export const useIdentity = (did) => useStore((s) => s.identities.find((i) => i.did === did))