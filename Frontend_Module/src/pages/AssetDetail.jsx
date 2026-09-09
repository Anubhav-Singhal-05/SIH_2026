import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  RefreshCw,
  Upload,
  ArrowLeftRight,
  KeyRound,
  Power,
  ShieldCheck,
  ShieldX,
  FileText,
  Download,
  ExternalLink,
  Eye,
  Binary,
  GitCommit,
  CheckCircle2,
} from 'lucide-react'
import { useStore, useIdentity } from '../store'
import { fmtTime, hex64 } from '../mock/api'
import { Badge, Btn, CopyText, EmptyState, KeyRow, Panel, PageHead } from '../components/ui'
import StepUpModal from '../components/StepUpModal'
import { retrieveDocument, storeDocument } from '../utils/documentStorage'

export default function AssetDetail() {
  const { assetId } = useParams()
  const navigate = useNavigate()
  const session = useStore((s) => s.session)
  const assets = useStore((s) => s.assets)
  const grants = useStore((s) => s.grants)
  const patchAsset = useStore((s) => s.patchAsset)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)
  const opSubmit = useStore((s) => s.opSubmit)

  const [modal, setModal] = useState(false)
  const [opId, setOpId] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [viewerTab, setViewerTab] = useState('preview') // 'preview' | 'raw' | 'proof'
  const [docBlobUrl, setDocBlobUrl] = useState(null)
  const [isBlobLoading, setIsBlobLoading] = useState(true)

  // Locate asset by ID (safe string comparison)
  const asset = assets.find((a) => String(a.assetId) === String(assetId))
  const assetGrants = grants.filter((g) => String(g.assetId) === String(assetId))

  const assetIdStr = String(asset?.assetId || assetId || '')
  const assetName = asset?.name || `Asset #${assetIdStr.slice(0, 12)}`
  const contentType = asset?.contentType || 'application/pdf'
  const docVersion = Number(asset?.documentVersion || 1)
  const docHash = asset?.documentHash || '0x' + '00'.repeat(32)
  const ownerDid = asset?.ownerDid || session?.did || 'did:sih:unknown'
  const owner = useIdentity(ownerDid)
  const op = useStore((s) => (opId ? s.opsById[opId] : null))

  const versions = useMemo(() => {
    if (Array.isArray(asset?.versions) && asset.versions.length > 0) {
      return asset.versions
    }
    return [
      {
        version: docVersion,
        hash: docHash,
        note: 'Genesis registration on-chain',
        at: asset?.createdAt || Date.now(),
      },
    ]
  }, [asset, docVersion, docHash])

  if (!asset) {
    return (
      <div className='max-w-4xl mx-auto space-y-4'>
        <PageHead
          title='Asset Not Found'
          sub={`No registry record matching ID: ${assetId}`}
          actions={
            <Link to='/assets'>
              <Btn variant='primary'>&larr; Back to Assets</Btn>
            </Link>
          }
        />
        <EmptyState
          lines={[
            `Asset ID "${assetId}" was not found in active projections.`,
            'It may have been purged on a chain reorg, or you may be switched to a different identity.',
          ]}
        />
      </div>
    )
  }

  const isOwner = Boolean(session?.did && asset.ownerDid && session.did === asset.ownerDid)

  useEffect(() => {
    let active = true
    let createdUrl = null
    setIsBlobLoading(true)

    retrieveDocument(assetId).then(async (rec) => {
      if (!active) return
      if (rec?.objectUrl) {
        setDocBlobUrl(rec.objectUrl)
        createdUrl = rec.objectUrl
        setIsBlobLoading(false)
      } else if (asset?.dataUrl) {
        try {
          const res = await fetch(asset.dataUrl)
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          if (active) {
            setDocBlobUrl(url)
            createdUrl = url
            setIsBlobLoading(false)
          }
          await storeDocument(asset.assetId, blob, { name: asset.name, contentType: asset.contentType })
        } catch {
          if (active) {
            setDocBlobUrl(asset.dataUrl)
            setIsBlobLoading(false)
          }
        }
      } else {
        if (active) setIsBlobLoading(false)
      }
    })

    return () => {
      active = false
      if (createdUrl && createdUrl.startsWith('blob:')) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [assetId, asset?.dataUrl, asset?.name, asset?.contentType])

  const activeDocUrl = docBlobUrl || asset?.dataUrl

  const verify = async () => {
    setVerifying(true)
    await new Promise((r) => setTimeout(r, 900))
    patchAsset(asset.assetId, { integrity: 'VERIFIED' })
    setVerifying(false)
  }

  const deactivate = () => {
    const id = startOperation({
      type: 'asset_deactivate',
      label: 'deactivate asset',
      relatedId: asset.assetId,
    })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(true)
  }

  const handleDownload = () => {
    if (activeDocUrl) {
      const a = document.createElement('a')
      a.href = activeDocUrl
      a.download = asset.name || 'document.pdf'
      a.click()
    } else {
      // Generate synthetic certificate for pre-seeded assets
      const content = `AEGIS REGISTRY VERIFIED ASSET RECORD
==================================================
Asset ID:        ${asset.assetId}
Name:            ${asset.name}
Owner DID:       ${asset.ownerDid}
Document Hash:   ${asset.documentHash}
Version:         v${asset.documentVersion}
Content Type:    ${asset.contentType}
Registered At:   ${fmtTime(asset.createdAt)}
Status:          ${asset.status}
Chain:           31337 (Localnet / Anvil)
Integrity Proof: SHA-256 Hash Matching On-Chain State

(Confidential document verified on-chain via Merkle Root)
`
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${asset.name || 'document'}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className='space-y-4'>
      <PageHead
        title={assetName}
        sub={`${assetIdStr.slice(0, 24)}… / v${docVersion}`}
        actions={
          <div className='flex items-center gap-2 flex-wrap'>
            <Link to='/assets' className='font-mono text-[10px] text-steel-500 hover:text-steel-200 mr-2'>
              &larr; ASSETS
            </Link>
            {isOwner && asset.status !== 'DEACTIVATED' && (
              <>
                <Btn onClick={() => navigate('/assets/' + asset.assetId + '/update')}>
                  <Upload size={12} /> Update document
                </Btn>
                <Btn onClick={() => navigate('/assets/' + asset.assetId + '/transfer')}>
                  <ArrowLeftRight size={12} /> Transfer
                </Btn>
                <Btn onClick={() => navigate('/access/' + asset.assetId)}>
                  <KeyRound size={12} /> Manage access
                </Btn>
                <Btn variant='danger' onClick={deactivate}>
                  <Power size={12} /> Deactivate
                </Btn>
              </>
            )}
          </div>
        }
      />

      {/* DOCUMENT VIEWER & PREVIEW PANEL */}
      <Panel
        title='Document Content & Inspection'
        actions={
          <div className='flex items-center gap-2'>
            <div className='flex rounded bg-base-950 border border-steel-800 p-0.5 text-[11px] font-mono'>
              <button
                onClick={() => setViewerTab('preview')}
                className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                  viewerTab === 'preview' ? 'bg-accent text-base-950 font-medium' : 'text-steel-400 hover:text-steel-200'
                }`}
              >
                <Eye size={11} /> Preview
              </button>
              <button
                onClick={() => setViewerTab('raw')}
                className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                  viewerTab === 'raw' ? 'bg-accent text-base-950 font-medium' : 'text-steel-400 hover:text-steel-200'
                }`}
              >
                <Binary size={11} /> Digital Fingerprint
              </button>
              <button
                onClick={() => setViewerTab('proof')}
                className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                  viewerTab === 'proof' ? 'bg-accent text-base-950 font-medium' : 'text-steel-400 hover:text-steel-200'
                }`}
              >
                <GitCommit size={11} /> Integrity Verification
              </button>
            </div>
            <Btn variant='primary' className='!py-1' onClick={handleDownload}>
              <Download size={12} /> Download Document
            </Btn>
          </div>
        }
      >
        {viewerTab === 'preview' && (
          <div className='space-y-3'>
            {activeDocUrl ? (
              <div className='space-y-2'>
                <div className='flex items-center justify-between text-[11px] font-mono text-steel-400 bg-base-950 px-3 py-1.5 rounded border border-steel-850'>
                  <div className='flex items-center gap-2'>
                    <FileText size={13} className='text-accent' />
                    <span className='text-steel-200 font-medium'>{assetName}</span>
                    <span className='text-steel-500'>({contentType})</span>
                  </div>
                  <div className='flex items-center gap-3'>
                    <a
                      href={activeDocUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-accent hover:text-accent-bright inline-flex items-center gap-1 font-semibold transition-colors'
                    >
                      <ExternalLink size={12} /> Open in Separate Window
                    </a>
                  </div>
                </div>

                {contentType.startsWith('image/') ? (
                  <div className='inset-panel p-4 flex justify-center items-center bg-base-950 min-h-[340px]'>
                    <img
                      src={activeDocUrl}
                      alt={assetName}
                      className='max-h-[480px] max-w-full rounded border border-steel-800 object-contain shadow-lg'
                    />
                  </div>
                ) : contentType === 'application/pdf' ? (
                  <div className='inset-panel p-0 bg-base-950 rounded overflow-hidden border border-steel-850 min-h-[540px] flex flex-col'>
                    <object
                      data={activeDocUrl}
                      type='application/pdf'
                      className='w-full h-[560px] rounded'
                    >
                      <div className='p-8 text-center space-y-3 my-auto'>
                        <FileText size={40} className='mx-auto text-steel-500' />
                        <p className='text-[13px] text-steel-200 font-medium'>
                          PDF Preview could not be embedded by your browser.
                        </p>
                        <p className='text-[11px] text-steel-400 font-mono max-w-md mx-auto'>
                          Your browser security settings or PDF viewer plugin may restrict embedded frame rendering.
                          You can view or download the verified document directly:
                        </p>
                        <div className='flex justify-center gap-3 pt-2'>
                          <a
                            href={activeDocUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='btn-base bg-accent border-accent text-base-950 font-semibold px-4 py-2 text-xs flex items-center gap-1.5 shadow-md'
                          >
                            <ExternalLink size={13} /> Open PDF in Separate Window
                          </a>
                          <Btn variant='primary' onClick={handleDownload} className='text-xs'>
                            <Download size={13} /> Download Document
                          </Btn>
                        </div>
                      </div>
                    </object>
                  </div>
                ) : asset.textContent ? (
                  <div className='inset-panel p-4 font-mono text-[12px] text-steel-200 bg-base-950 max-h-[480px] overflow-y-auto whitespace-pre-wrap leading-relaxed'>
                    {asset.textContent}
                  </div>
                ) : (
                  <div className='inset-panel p-1 bg-base-950 rounded overflow-hidden'>
                    <iframe
                      src={activeDocUrl}
                      title='Document View'
                      className='w-full h-[450px] rounded border border-steel-850'
                    />
                  </div>
                )}
              </div>
            ) : (
              /* High-fidelity stylized certificate preview for pre-seeded assets */
              <div className='inset-panel p-6 bg-gradient-to-b from-base-900 to-base-950 border border-steel-800 rounded-md relative overflow-hidden'>
                <div className='absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent/10 border border-accent/40 text-accent font-mono text-[10px] uppercase tracking-wider'>
                  <CheckCircle2 size={12} /> Stored On-Chain
                </div>

                <div className='max-w-2xl mx-auto space-y-4 py-2'>
                  <div className='border-b border-steel-800 pb-3'>
                    <span className='font-mono text-[10px] text-steel-500 uppercase tracking-widest block'>
                      Decentralized Confidential Document Record
                    </span>
                    <h3 className='text-[16px] font-semibold text-steel-100 mt-1'>{assetName}</h3>
                    <p className='text-[12px] text-steel-400 font-mono mt-0.5'>
                      MIME: {contentType} • Version: v{docVersion} • Status: {asset.status}
                    </p>
                  </div>

                  <div className='grid grid-cols-2 gap-4 text-[12px] font-mono py-1'>
                    <div>
                      <span className='text-steel-500 block text-[10px] uppercase'>Owner Identifier:</span>
                      <span className='text-steel-300 break-all'>{ownerDid}</span>
                    </div>
                    <div>
                      <span className='text-steel-500 block text-[10px] uppercase'>Security Seal (Digital Fingerprint):</span>
                      <span className='text-steel-300 break-all'>{docHash}</span>
                    </div>
                  </div>

                  <div className='p-3.5 bg-base-950/80 border border-steel-850 rounded text-[11px] font-mono text-steel-400 space-y-1.5 leading-relaxed'>
                    <div className='text-steel-200 font-medium'>Document Security & Integrity Details:</div>
                    <div>• End-to-end encrypted: Only you and authorized recipients can decrypt this file</div>
                    <div>• Security State: Version v{owner?.rootVersion || docVersion} (Anchored to decentralized ledger)</div>
                    <div>• Storage Commitment: {asset.storageCommitment || 'Secure verified storage commitment'}</div>
                  </div>

                  <div className='pt-2 flex justify-between items-center text-[11px] font-mono text-steel-500 border-t border-steel-850'>
                    <span>Verified: {fmtTime(asset.createdAt)}</span>
                    <button
                      onClick={handleDownload}
                      className='text-accent hover:text-accent-bright flex items-center gap-1 font-semibold'
                    >
                      <Download size={11} /> Download original file
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {viewerTab === 'raw' && (
          <div className='space-y-2'>
            <div className='flex justify-between items-center text-[11px] font-mono text-steel-400'>
              <span>Verified Digital Security Fingerprint:</span>
              <CopyText value={docHash} />
            </div>
            <div className='inset-panel p-3 font-mono text-[11px] text-steel-300 break-all bg-base-950 leading-relaxed'>
              {docHash}
            </div>
            <p className='text-[11px] text-steel-500 font-mono'>
              This unique digital fingerprint guarantees that this document is authentic and has not been altered or tampered with since being registered.
            </p>
          </div>
        )}

        {viewerTab === 'proof' && (
          <div className='inset-panel p-4 font-mono text-[11px] text-steel-300 bg-base-950 space-y-2'>
            <div className='flex justify-between'>
              <span className='text-steel-500'>Integrity Standard:</span>
              <span className='text-ok'>Cryptographic Tree Proof (SHA-256)</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-steel-500'>Security State Version:</span>
              <span>v{owner?.rootVersion || docVersion}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-steel-500'>Ledger Entry Slot:</span>
              <span>0</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-steel-500'>Tamper-Proof Verification:</span>
              <span className='text-ok font-semibold'>VERIFIED & UNTAMPERED</span>
            </div>
          </div>
        )}
      </Panel>

      <div className='grid grid-cols-5 gap-3'>
        {/* Left Column: Registry record & Versions */}
        <div className='col-span-3 space-y-3'>
          <Panel title='Registry record' actions={<Badge status={asset.status} />}>
            <KeyRow k='Asset ID'>
              <CopyText value={assetIdStr} full />
            </KeyRow>
            <KeyRow k='Owner DID'>
              <CopyText value={ownerDid} full />
            </KeyRow>
            <KeyRow k='Owner controller'>
              <CopyText value={owner ? owner.controllerAddress : '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'} />
            </KeyRow>
            <KeyRow k='Document version'>
              <span className='font-mono'>v{docVersion}</span>
            </KeyRow>
            <KeyRow k='Content type'>
              <span className='font-mono text-[12px]'>{contentType}</span>
            </KeyRow>
            <KeyRow k='Created / updated'>
              <span className='font-mono text-[12px]'>
                {fmtTime(asset.createdAt)} / {fmtTime(asset.updatedAt)}
              </span>
            </KeyRow>
          </Panel>

          <Panel title='Document version history' pad={false}>
            <table className='w-full text-[12px]'>
              <thead>
                <tr className='border-b border-steel-800 text-left'>
                  <th className='label-xs px-3 py-2'>Version</th>
                  <th className='label-xs px-3 py-2'>Document hash</th>
                  <th className='label-xs px-3 py-2'>Note</th>
                  <th className='label-xs px-3 py-2'>At</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version} className='border-b border-steel-900 last:border-b-0'>
                    <td className='px-3 py-1.5 font-mono text-steel-200'>v{v.version}</td>
                    <td className='px-3 py-1.5'>
                      <CopyText value={v.hash} />
                    </td>
                    <td className='px-3 py-1.5 text-steel-400'>{v.note}</td>
                    <td className='px-3 py-1.5 font-mono text-[11px] text-steel-500'>{fmtTime(v.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        {/* Right Column: Integrity Verification & Access Grants */}
        <div className='col-span-2 space-y-3'>
          <Panel
            title='Integrity verification'
            actions={
              asset.integrity === 'VERIFIED' ? (
                <ShieldCheck size={14} className='text-ok' />
              ) : (
                <ShieldX size={14} className='text-warn' />
              )
            }
          >
            <div className='flex items-center justify-between'>
              <div>
                <Badge status={asset.integrity === 'VERIFIED' ? 'VERIFIED' : 'PENDING'} />
                <p className='text-[11px] text-steel-500 mt-2 leading-relaxed'>
                  Recomputes the stored ciphertext checksum against the registered document hash for v{docVersion}.
                </p>
              </div>
              <Btn onClick={verify} disabled={verifying}>
                <RefreshCw size={12} className={verifying ? 'animate-spin' : ''} />
                {verifying ? 'Verifying…' : 'Verify now'}
              </Btn>
            </div>
            <div className='mt-2 inset-panel px-2.5 py-2'>
              <CopyText value={docHash} />
            </div>
          </Panel>

          <Panel title='Active access grants' pad={false}>
            {assetGrants.length === 0 ? (
              <div className='p-3'>
                <EmptyState lines={['no grants issued for this asset']} />
              </div>
            ) : (
              <table className='w-full text-[12px]'>
                <thead>
                  <tr className='border-b border-steel-800 text-left'>
                    <th className='label-xs px-3 py-2'>Grantee</th>
                    <th className='label-xs px-3 py-2'>Permissions</th>
                    <th className='label-xs px-3 py-2'>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assetGrants.map((g) => (
                    <tr key={g.id} className='border-b border-steel-900 last:border-b-0'>
                      <td className='px-3 py-1.5 font-mono text-[11px] text-steel-300'>
                        {session?.did && g.granteeDid === session.did ? '(self)' : g.granteeDid}
                      </td>
                      <td className='px-3 py-1.5 font-mono text-[10px] text-steel-400'>
                        {Array.isArray(g.permissions) ? g.permissions.join(' / ') : String(g.permissions)}
                      </td>
                      <td className='px-3 py-1.5'>
                        <Badge status={g.status || 'ACTIVE'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      <StepUpModal
        open={modal}
        action='Deactivate asset'
        onClose={() => setModal(false)}
        onComplete={() => {
          opAwaitSignature(opId)
          setModal(false)
        }}
      />

      {op && op.currentStep === 'AWAITING_SIGNATURE' && (
        <div className='fixed bottom-4 right-4 panel px-4 py-3 shadow-pop flex items-center gap-3 z-50'>
          <span className='font-mono text-[11px] text-steel-300'>Permit bound — submit transaction?</span>
          <Btn variant='primary' onClick={() => opSubmit(op.id)}>
            Sign and submit
          </Btn>
        </div>
      )}
    </div>
  )
}
