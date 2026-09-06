import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { FileSearch, RefreshCw, Upload, ArrowLeftRight, KeyRound, Power, ShieldCheck, ShieldX } from 'lucide-react'
import { useStore, useIdentity } from '../store'
import { fmtTime, hex64 } from '../mock/api'
import { Badge, Btn, CopyText, EmptyState, KeyRow, Panel, PageHead, Stepper } from '../components/ui'
import StepUpModal from '../components/StepUpModal'

export default function AssetDetail() {
  const { assetId } = useParams()
  const navigate = useNavigate()
  const session = useStore((s) => s.session)
  const asset = useStore((s) => s.assets.find((a) => a.assetId === assetId))
  const grants = useStore((s) => s.grants.filter((g) => g.assetId === assetId))
  const patchAsset = useStore((s) => s.patchAsset)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)
  const opSubmit = useStore((s) => s.opSubmit)
  const [modal, setModal] = useState(false)
  const [opId, setOpId] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const owner = useIdentity(asset ? asset.ownerDid : null)
  const op = useStore((s) => (opId ? s.opsById[opId] : null))

  if (!asset) {
    return <div><PageHead title='Asset' /><EmptyState lines={['asset not found: '+assetId]} /></div>
  }

  const verify = async () => {
    setVerifying(true)
    await new Promise((r) => setTimeout(r, 1200))
    patchAsset(asset.assetId, { integrity: 'VERIFIED' })
    setVerifying(false)
  }
  const deactivate = () => {
    const id = startOperation({ type: 'asset_deactivate', label: 'deactivate asset', relatedId: asset.assetId })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(true)
  }
  const isOwner = asset.ownerDid === session.did
  return (
    <div>
      <PageHead
        title={asset.name}
        sub={asset.assetId.slice(0, 24) + '… / v' + asset.documentVersion}
        actions={
          <>
            <Link to='/assets' className='font-mono text-[10px] text-steel-500 hover:text-steel-200'>&larr; ASSETS</Link>
            {isOwner && asset.status !== 'DEACTIVATED' && (
              <>
                <Btn onClick={() => navigate('/assets/' + asset.assetId + '/update')}><Upload size={12} /> Update document</Btn>
                <Btn onClick={() => navigate('/assets/' + asset.assetId + '/transfer')}><ArrowLeftRight size={12} /> Transfer</Btn>
                <Btn onClick={() => navigate('/access/' + asset.assetId)}><KeyRound size={12} /> Manage access</Btn>
                <Btn variant='danger' onClick={deactivate}><Power size={12} /> Deactivate</Btn>
              </>
            )}
          </>
        }
      />
      <div className='grid grid-cols-5 gap-3'>
        <div className='col-span-3 space-y-3'>
          <Panel title='Registry record' actions={<Badge status={asset.status} />}>
            <KeyRow k='Asset ID'><CopyText value={asset.assetId} full /></KeyRow>
            <KeyRow k='Owner DID'><CopyText value={asset.ownerDid} full /></KeyRow>
            <KeyRow k='Owner controller'><CopyText value={owner ? owner.controllerAddress : '-'} /></KeyRow>
            <KeyRow k='Document version'><span className='font-mono'>v{asset.documentVersion}</span></KeyRow>
            <KeyRow k='Content type'><span className='font-mono text-[12px]'>{asset.contentType}</span></KeyRow>
            <KeyRow k='Created / updated'><span className='font-mono text-[12px]'>{fmtTime(asset.createdAt)} / {fmtTime(asset.updatedAt)}</span></KeyRow>
          </Panel>
          <Panel title='Document version history' pad={false}>
            <table className='w-full text-[12px]'>
              <thead><tr className='border-b border-steel-800 text-left'>
                <th className='label-xs px-3 py-2'>Version</th><th className='label-xs px-3 py-2'>Document hash</th><th className='label-xs px-3 py-2'>Note</th><th className='label-xs px-3 py-2'>At</th>
              </tr></thead>
              <tbody>
                {asset.versions.map((v) => (
                  <tr key={v.version} className='border-b border-steel-900 last:border-b-0'>
                    <td className='px-3 py-1.5 font-mono text-steel-200'>v{v.version}</td>
                    <td className='px-3 py-1.5'><CopyText value={v.hash} /></td>
                    <td className='px-3 py-1.5 text-steel-400'>{v.note}</td>
                    <td className='px-3 py-1.5 font-mono text-[11px] text-steel-500'>{fmtTime(v.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
        <div className='col-span-2 space-y-3'>
          <Panel title='Integrity verification' actions={asset.integrity === 'VERIFIED' ? <ShieldCheck size={13} className='text-ok' /> : <ShieldX size={13} className='text-warn' />}>
            <div className='flex items-center justify-between'>
              <div>
                <Badge status={asset.integrity === 'VERIFIED' ? 'VERIFIED' : 'PENDING'} />
                <p className='text-[11px] text-steel-500 mt-2 leading-relaxed'>Recomputes the stored ciphertext checksum against the registered document hash for v{asset.documentVersion}.</p>
              </div>
              <Btn onClick={verify} disabled={verifying}><RefreshCw size={12} className={verifying ? 'animate-spin' : ''} /> {verifying ? 'Verifying…' : 'Verify now'}</Btn>
            </div>
            <div className='mt-2 inset-panel px-2.5 py-2'><CopyText value={asset.documentHash} /></div>
          </Panel>
          <Panel title='Active access grants' pad={false}>
            {grants.length === 0 ? <div className='p-3'><EmptyState lines={['no grants issued for this asset']} /></div> : (
              <table className='w-full text-[12px]'>
                <thead><tr className='border-b border-steel-800 text-left'><th className='label-xs px-3 py-2'>Grantee</th><th className='label-xs px-3 py-2'>Permissions</th><th className='label-xs px-3 py-2'>Status</th></tr></thead>
                <tbody>
                  {grants.map((g) => (
                    <tr key={g.id} className='border-b border-steel-900 last:border-b-0'>
                      <td className='px-3 py-1.5 font-mono text-[11px] text-steel-300'>{g.granteeDid === session.did ? '(self)' : g.granteeDid}</td>
                      <td className='px-3 py-1.5 font-mono text-[10px] text-steel-400'>{g.permissions.join(' / ')}</td>
                      <td className='px-3 py-1.5'><Badge status={g.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
      <StepUpModal open={modal} action='Deactivate asset' onClose={() => setModal(false)} onComplete={() => { opAwaitSignature(opId); setModal(false) }} />
      {op && op.currentStep === 'AWAITING_SIGNATURE' && (
        <div className='fixed bottom-4 right-4 panel px-4 py-3 shadow-pop flex items-center gap-3 z-50'>
          <span className='font-mono text-[11px] text-steel-300'>Permit bound — submit transaction?</span>
          <Btn variant='primary' onClick={() => opSubmit(op.id)}>Sign and submit</Btn>
        </div>
      )}
    </div>
  )
}