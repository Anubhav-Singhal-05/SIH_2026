import { hex64, hex, uuid, now, assetId } from './api'

const D = (d) => now() - d * 86400000
const addr = () => '0x' + hex(40)
const fp = () => '0x' + hex(20).toUpperCase()
const h64 = () => hex64()

export const SELF_DID = 'did:platform:alcott.main'
export const OTHER_DIDS = [
  'did:platform:meridian.trust',
  'did:platform:northgate.custody',
  'did:platform:vale.post',
  'did:platform:kessler.estate',
  'did:platform:brannoch.inv',
  'did:platform:oberon.fid',
  'did:platform:tanner.escrow',
  'did:platform:quill.arch',
]

export const identities = [
  { did: SELF_DID, controllerAddress: addr(), encryptionKeyFingerprint: fp(), status: 'ACTIVE', rootVersion: 7, rootHistory: [
    { version: 7, rootHash: h64(), at: D(2), action: 'asset_minted' },
    { version: 6, rootHash: h64(), at: D(9), action: 'access_granted' },
    { version: 5, rootHash: h64(), at: D(21), action: 'asset_transferred' },
    { version: 4, rootHash: h64(), at: D(34), action: 'document_updated' },
    { version: 3, rootHash: h64(), at: D(52), action: 'asset_minted' },
    { version: 2, rootHash: h64(), at: D(70), action: 'controller_rotated' },
    { version: 1, rootHash: h64(), at: D(90), action: 'genesis' },
  ] },
  ...OTHER_DIDS.map((did, i) => ({ did, controllerAddress: addr(), encryptionKeyFingerprint: fp(), status: i === 3 ? 'SUSPENDED' : 'ACTIVE', rootVersion: 3 + i, rootHistory: [
    { version: 3 + i, rootHash: h64(), at: D(4 + i), action: 'asset_minted' },
    { version: 2 + i, rootHash: h64(), at: D(30 + i), action: 'access_granted' },
    { version: 1 + i, rootHash: h64(), at: D(60 + i), action: 'genesis' },
  ] })),
]

const mkAsset = (name, ct, ownerDid, status, ver, days) => {
  const versions = []
  for (let v = 1; v <= ver; v++) versions.push({ version: v, hash: h64(), note: v === 1 ? 'initial mint' : 'revision ' + v, at: D(days + (ver - v) * 11) })
  return { assetId: assetId(), name, contentType: ct, ownerDid, documentVersion: ver, status, documentHash: versions[versions.length - 1].hash, createdAt: D(days), updatedAt: D(days - 3), versions, integrity: status === 'CONFIRMED' ? 'VERIFIED' : 'PENDING' }
}

export const assets = [
  mkAsset('Q3-Custody-Agreement.pdf', 'application/pdf', SELF_DID, 'CONFIRMED', 3, 40),
  mkAsset('Shareholder-Register-2026.csv', 'text/csv', SELF_DID, 'CONFIRMED', 1, 33),
  mkAsset('Board-Minutes-2026-05.pdf', 'application/pdf', SELF_DID, 'CONFIRMED', 2, 27),
  mkAsset('Trust-Deed-Annex-B.pdf', 'application/pdf', SELF_DID, 'CONFIRMED', 4, 88),
  mkAsset('Wire-Instruction-8841.pdf', 'application/pdf', SELF_DID, 'STAGED', 1, 2),
  mkAsset('Cap-Table-Snapshot.csv', 'text/csv', SELF_DID, 'DEACTIVATED', 2, 96),
  mkAsset('Escrow-Terms-vFinal.pdf', 'application/pdf', OTHER_DIDS[0], 'CONFIRMED', 2, 18),
  mkAsset('KYC-Portfolio-77.pdf', 'application/pdf', OTHER_DIDS[1], 'CONFIRMED', 1, 25),
  mkAsset('Security-Pledge-Deed.pdf', 'application/pdf', OTHER_DIDS[2], 'CONFIRMED', 3, 44),
  mkAsset('Notarized-Signature-Sheet.pdf', 'application/pdf', OTHER_DIDS[0], 'CONFIRMED', 1, 12),
  mkAsset('Collateral-Schedule.csv', 'text/csv', OTHER_DIDS[4], 'CONFIRMED', 2, 61),
  mkAsset('Estate-Inventory.pdf', 'application/pdf', OTHER_DIDS[5], 'CONFIRMED', 1, 73),
]

const g = (i, grantee, perms, expDays, status) => ({ id: uuid(), assetId: assets[i].assetId, granteeDid: grantee, permissions: perms, grantedAt: D(expDays + 20), expiresAt: expDays < 0 ? D(-expDays * -1) : now() + expDays * 86400000, status })
export const grants = [
  g(0, OTHER_DIDS[1], ['READ', 'VERIFY'], 30, 'ACTIVE'),
  g(0, OTHER_DIDS[3], ['READ'], 400, 'EXPIRED'),
  g(1, OTHER_DIDS[0], ['READ', 'SHARE'], 90, 'ACTIVE'),
  g(2, OTHER_DIDS[4], ['VERIFY'], 14, 'ACTIVE'),
  g(3, OTHER_DIDS[2], ['READ'], 180, 'ACTIVE'),
  g(6, SELF_DID, ['READ', 'VERIFY'], 60, 'ACTIVE'),
  g(7, SELF_DID, ['READ'], -5, 'EXPIRED'),
  g(8, SELF_DID, ['READ', 'SHARE'], 120, 'ACTIVE'),
  g(1, OTHER_DIDS[5], ['READ'], 10, 'REVOKED'),
  g(10, SELF_DID, ['VERIFY'], 25, 'ACTIVE'),
]

export const inheritanceRule = {
  ownerDid: SELF_DID,
  defaultNomineeDid: OTHER_DIDS[2],
  perAssetOverrides: [
    { assetId: assets[0].assetId, beneficiaryDid: OTHER_DIDS[0] },
    { assetId: assets[3].assetId, beneficiaryDid: OTHER_DIDS[6] },
  ],
  authoritySet: [
    { label: 'AUTH-1', did: OTHER_DIDS[1], signed: false },
    { label: 'AUTH-2', did: OTHER_DIDS[4], signed: false },
    { label: 'AUTH-3', did: OTHER_DIDS[7], signed: false },
  ],
  signaturesRequired: 2,
  status: 'CONFIGURED',
  activatedAt: null,
  batchProgress: [],
}

const ACTION_TYPES = ['mint_intent','document_update','transfer','grant_created','grant_revoked','controller_rotated','identity_suspended','inheritance_configured','asset_deactivated']
export const audits = Array.from({ length: 18 }, (_, i) => ({
  id: uuid(),
  actorDidHash: hex64(),
  action: ACTION_TYPES[i % ACTION_TYPES.length],
  target: i % 3 === 0 ? OTHER_DIDS[i % OTHER_DIDS.length] : assets[i % assets.length].assetId,
  result: i === 5 || i === 11 ? 'failure' : 'success',
  requestId: 'req-' + hex(12),
  operationId: i % 2 ? uuid() : null,
  at: D(14 - i * 0.75),
}))
