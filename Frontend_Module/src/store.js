import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { identities as seedIdentities, assets as seedAssets, grants as seedGrants, inheritanceRule as seedRule, audits as seedAudits, SELF_DID } from './mock/fixtures'
import { uuid, hex64, now, ERROR_COPY, hex } from './mock/api'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const STEP_ORDER = ['STAGED','AWAITING_STEP_UP','AWAITING_SIGNATURE','SUBMITTED','CONFIRMED']

export const useStore = create(
  persist(
    (set, get) => {
      const setOp = (id, patch) => set((s) => ({ opsById: { ...s.opsById, [id]: { ...s.opsById[id], ...patch } } }))
      const pushOpStep = (id, step) => set((s) => {
        const op = s.opsById[id]
        if (!op) return s
        return { opsById: { ...s.opsById, [id]: { ...op, currentStep: step, updatedAt: now(), trail: [...op.trail, { step, at: now() }] } } }
      })
      const addAudit = (a) => set((s) => ({
        audits: [
          {
            id: uuid(),
            actorDidHash: a.actorDidHash || hex64(),
            actorDid: a.actorDid || s.session?.did || null,
            requestId: 'req-' + hex(12),
            operationId: a.operationId || null,
            at: now(),
            result: a.result || 'success',
            target: a.target || '-',
            action: a.action,
            ...a,
          },
          ...s.audits,
        ],
      }))

      return {
        // ---- session ----
        session: null,
        login: async (did, passkey) => {
          await sleep(600)
          const s = get()
          const query = (did || '').trim()
          if (!query) throw new Error('DID or Username is required')
          const found = s.identities.find((i) =>
            i.did === query ||
            i.did.toLowerCase() === query.toLowerCase() ||
            (i.name && i.name.toLowerCase() === query.toLowerCase())
          )
          if (!found) {
            throw new Error(`Identity "${query}" not found. Please verify or create a new DID.`)
          }
          const targetDid = found.did
          const expectedPasskey = found.passkey || 'passkey123'
          if (passkey && passkey !== expectedPasskey) {
            throw new Error('INCORRECT_PASSKEY')
          }
          const didRule = (s.inheritancesByDid && s.inheritancesByDid[targetDid]) || (targetDid === SELF_DID ? { ...seedRule } : {
            ownerDid: targetDid,
            defaultNomineeDid: '',
            perAssetOverrides: [],
            authoritySet: [
              { label: 'AUTH-1', did: 'did:platform:meridian.trust', signed: false },
              { label: 'AUTH-2', did: 'did:platform:northgate.custody', signed: false },
              { label: 'AUTH-3', did: 'did:platform:quill.arch', signed: false },
            ],
            signaturesRequired: 2,
            status: 'NOT_CONFIGURED',
            activatedAt: null,
            batchProgress: [],
          })
          set({
            session: {
              did: targetDid,
              accessToken: hex(32),
              loginAt: now(),
              name: found?.name || targetDid.split(':')[2] || 'Operator',
              controllerAddress: found?.controllerAddress || '0x' + hex(40),
            },
            inheritance: didRule,
          })
          return { ok: true }
        },
        verifyPasskey: (did, passkey) => {
          const s = get()
          const id = s.identities.find((i) => i.did === did)
          if (!id) return false
          const expected = id.passkey || 'passkey123'
          return passkey === expected
        },
        logout: () => set({ session: null }),
        registerDid: async ({ name, did, controllerAddress, organization, email, passkey }) => {
          await sleep(800)
          const cleanName = (name || 'operator').trim()
          const finalDid = did?.trim() || ('did:sih:' + cleanName.toLowerCase().replace(/[^a-z0-9.]/g, '.') + '.main')
          const controller = controllerAddress?.trim() || ('0x' + hex(40))
          const id = {
            did: finalDid,
            name: cleanName,
            passkey: passkey || 'passkey123',
            controllerAddress: controller,
            encryptionKeyFingerprint: '0x' + hex(20).toUpperCase(),
            organization: organization?.trim() || 'Aegis Platform Identity',
            email: email?.trim() || '',
            status: 'ACTIVE',
            rootVersion: 1,
            rootHistory: [{ version: 1, rootHash: hex64(), at: now(), action: 'genesis' }],
          }
          set((s) => ({
            identities: [id, ...s.identities.filter((x) => x.did !== finalDid)],
            inheritancesByDid: {
              ...(s.inheritancesByDid || {}),
              [finalDid]: {
                ownerDid: finalDid,
                defaultNomineeDid: '',
                perAssetOverrides: [],
                authoritySet: [
                  { label: 'AUTH-1', did: 'did:platform:meridian.trust', signed: false },
                  { label: 'AUTH-2', did: 'did:platform:northgate.custody', signed: false },
                  { label: 'AUTH-3', did: 'did:platform:quill.arch', signed: false },
                ],
                signaturesRequired: 2,
                status: 'NOT_CONFIGURED',
                activatedAt: null,
                batchProgress: [],
              },
            },
          }))
          addAudit({
            action: 'identity_registered',
            target: finalDid,
            actorDid: finalDid,
            result: 'success',
          })
          return id
        },

        // ---- entities ----
        identities: seedIdentities,
        assets: seedAssets,
        grants: seedGrants,
        inheritance: { ...seedRule },
        inheritancesByDid: { [SELF_DID]: { ...seedRule } },
        audits: seedAudits,
        addAsset: (a) => set((s) => ({
          assets: [a, ...s.assets.filter((x) => String(x.assetId) !== String(a.assetId))],
        })),
        patchAsset: (assetId, patch) => set((s) => ({
          assets: s.assets.map((a) => (String(a.assetId) === String(assetId) ? { ...a, ...patch, updatedAt: now() } : a)),
        })),
        bumpRoot: (did, action) => set((s) => ({
          identities: s.identities.map((i) =>
            i.did === did
              ? {
                  ...i,
                  rootVersion: (i.rootVersion || 1) + 1,
                  rootHistory: [
                    { version: (i.rootVersion || 1) + 1, rootHash: hex64(), at: now(), action },
                    ...(i.rootHistory || []),
                  ],
                }
              : i
          ),
        })),
        setIdentityStatus: (did, status) => set((s) => ({
          identities: s.identities.map((i) => (i.did === did ? { ...i, status } : i)),
        })),
        rotateController: (did) => set((s) => ({
          identities: s.identities.map((i) => (i.did === did ? { ...i, controllerAddress: '0x' + hex(40) } : i)),
        })),
        addGrant: (gr) => set((s) => ({ grants: [gr, ...s.grants] })),
        revokeGrant: (gid) => set((s) => ({ grants: s.grants.map((g) => (g.id === gid ? { ...g, status: 'REVOKED' } : g)) })),
        patchInheritance: (patch) => {
          const s = get()
          const did = s.session?.did || SELF_DID
          const current = (s.inheritancesByDid && s.inheritancesByDid[did]) || s.inheritance || {
            ownerDid: did,
            defaultNomineeDid: '',
            perAssetOverrides: [],
            authoritySet: [
              { label: 'AUTH-1', did: 'did:platform:meridian.trust', signed: false },
              { label: 'AUTH-2', did: 'did:platform:northgate.custody', signed: false },
              { label: 'AUTH-3', did: 'did:platform:quill.arch', signed: false },
            ],
            signaturesRequired: 2,
            status: 'NOT_CONFIGURED',
            activatedAt: null,
            batchProgress: [],
          }
          const updated = { ...current, ...patch }
          set({
            inheritancesByDid: {
              ...(s.inheritancesByDid || {}),
              [did]: updated,
            },
            inheritance: updated,
          })
        },

        // ---- operations lifecycle ----
        opsById: {},
        opOrder: [],
        startOperation: ({ type, label, relatedId, payload }) => {
          const id = uuid()
          set((s) => ({
            opsById: {
              ...s.opsById,
              [id]: {
                id,
                type,
                label,
                relatedId: relatedId || null,
                payload: payload || null,
                currentStep: 'STAGED',
                createdAt: now(),
                updatedAt: now(),
                trail: [{ step: 'STAGED', at: now() }],
                result: null,
                failCode: null,
              },
            },
            opOrder: [id, ...s.opOrder],
          }))
          return id
        },
        opAwaitStepUp: (id) => pushOpStep(id, 'AWAITING_STEP_UP'),
        opAwaitSignature: (id) => pushOpStep(id, 'AWAITING_SIGNATURE'),
        opSubmit: (id) => {
          pushOpStep(id, 'SUBMITTED')
          const latency = 1800 + Math.floor(Math.random() * 1500)
          setTimeout(() => {
            const op = get().opsById[id]
            if (!op) return
            const injected = get().injectNext
            const outcome = injected ? injected : (Math.random() < 0.04 ? 'REORGED' : 'CONFIRMED')
            const callerDid = get().session?.did || null
            if (outcome === 'CONFIRMED') {
              pushOpStep(id, 'CONFIRMED')
              setOp(id, { result: 'success' })
              addAudit({ action: op.type + '_confirmed', target: op.relatedId || op.label, actorDid: callerDid, operationId: id, result: 'success' })
              get().applySideEffects(op)
            } else if (outcome === 'REORGED') {
              pushOpStep(id, 'REORGED')
              setOp(id, { result: 'reorged' })
              addAudit({ action: op.type + '_reorged', target: op.relatedId || op.label, actorDid: callerDid, operationId: id, result: 'failure' })
              set({ reorg: { visible: true, opId: id } })
            } else {
              pushOpStep(id, 'FAILED')
              setOp(id, { result: 'failure', failCode: outcome })
              addAudit({ action: op.type + '_failed', target: op.relatedId || op.label, actorDid: callerDid, operationId: id, result: 'failure' })
              get().pushError(outcome)
            }
            set({ injectNext: null })
          }, latency)
        },

        applySideEffects: (op) => {
          const s = get()
          if (op.type === 'mint' && op.payload) {
            const confirmedAsset = {
              ...op.payload,
              status: 'CONFIRMED',
              updatedAt: now(),
            }
            s.addAsset(confirmedAsset)
            if (s.session?.did) s.bumpRoot(s.session.did, 'asset_minted')
          }
          if (op.type === 'update' && op.relatedId) {
            const a = s.assets.find((x) => String(x.assetId) === String(op.relatedId))
            if (a) {
              const nv = (a.documentVersion || 1) + 1
              s.patchAsset(op.relatedId, {
                documentVersion: nv,
                documentHash: op.payload.hash,
                versions: [...(a.versions || []), { version: nv, hash: op.payload.hash, note: op.payload.note, at: now() }],
                integrity: 'VERIFIED',
              })
              if (s.session?.did) s.bumpRoot(s.session.did, 'document_updated')
            }
          }
          if (op.type === 'transfer' && op.relatedId && op.payload) {
            s.patchAsset(op.relatedId, { ownerDid: op.payload.to })
            if (op.payload.from) s.bumpRoot(op.payload.from, 'asset_transferred')
            if (op.payload.to) s.bumpRoot(op.payload.to, 'asset_transferred')
          }
          if (op.type === 'grant' && op.payload) {
            s.addGrant(op.payload)
            if (s.session?.did) s.bumpRoot(s.session.did, 'access_granted')
          }
          if (op.type === 'revoke' && op.payload) {
            s.revokeGrant(op.payload)
            if (s.session?.did) s.bumpRoot(s.session.did, 'access_revoked')
          }
          if (op.type === 'rotate') {
            if (s.session?.did) {
              s.rotateController(s.session.did)
              s.bumpRoot(s.session.did, 'controller_rotated')
            }
          }
          if (op.type === 'suspend') {
            if (s.session?.did) {
              s.setIdentityStatus(s.session.did, 'SUSPENDED')
              s.bumpRoot(s.session.did, 'identity_suspended')
            }
          }
          if (op.type === 'deactivate') {
            if (s.session?.did) {
              s.setIdentityStatus(s.session.did, 'DEACTIVATED')
              s.bumpRoot(s.session.did, 'identity_deactivated')
            }
          }
          if (op.type === 'inheritance_config' && op.payload) {
            s.patchInheritance(op.payload)
            if (s.session?.did) s.bumpRoot(s.session.did, 'inheritance_configured')
          }
          if (op.type === 'inheritance_activate') {
            s.patchInheritance({ status: 'ACTIVE', activatedAt: now() })
            if (s.session?.did) s.bumpRoot(s.session.did, 'inheritance_activated')
          }
          if (op.type === 'asset_deactivate' && op.relatedId) {
            s.patchAsset(op.relatedId, { status: 'DEACTIVATED' })
            if (s.session?.did) s.bumpRoot(s.session.did, 'asset_deactivated')
          }
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
          if (confirmed) {
            pushOpStep(confirmed.id, 'REORGED')
            setOp(confirmed.id, { result: 'reorged' })
            addAudit({ action: 'chain_reorg', target: confirmed.relatedId || confirmed.label, result: 'failure' })
          }
          set({ reorg: { visible: true, opId: confirmed ? confirmed.id : null } })
        },
        dismissReorg: () => set((s) => ({ reorg: { ...s.reorg, visible: false } })),
        setOpsOpen: (v) => set({ opsOpen: v }),
        errorCopy: ERROR_COPY,
      }
    },
    {
      name: 'aegis_platform_storage',
      partialize: (state) => ({
        session: state.session,
        identities: state.identities,
        assets: (state.assets || []).map((a) => {
          // If dataUrl is > 200KB, omit it from localStorage since IndexedDB holds the document blob
          if (a.dataUrl && a.dataUrl.length > 200000) {
            const { dataUrl, ...rest } = a
            return rest
          }
          return a
        }),
        grants: state.grants,
        inheritance: state.inheritance,
        inheritancesByDid: state.inheritancesByDid,
        audits: state.audits,
      }),
    }
  )
)

export const useOp = (id) => useStore((s) => (id ? s.opsById[id] : null))
export const useActiveOps = () => useStore((s) => s.opOrder.map((id) => s.opsById[id]).filter((o) => o && !o.result))
export const useIdentity = (did) => useStore((s) => s.identities.find((i) => i.did === did))
