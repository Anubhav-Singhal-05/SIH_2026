import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Ban, Plus } from 'lucide-react'
import { useStore } from '../store'
import { OTHER_DIDS } from '../mock/fixtures'
import { uuid, now, fmtTime } from '../mock/api'
import { Badge, Btn, CopyText, EmptyState, Field, KeyRow, PageHead, Panel, SkeletonRows, selectCls, inputCls, Stepper } from '../components/ui'
import StepUpModal from '../components/StepUpModal'
import { useOp } from '../store'

const PERMS = ['READ', 'SHARE', 'VERIFY']

function GrantOpLine({ id }) { const op = useOp(id); return op ? <div className='mt-2'><Stepper op={op} compact /></div> : null }

export default function AccessManagement() {
  const { assetId } = useParams()
  const session = useStore((s) => s.session)
  const assets = useStore((s) => s.assets)
  const grants = useStore((s) => s.grants)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)
  const [scope, setScope] = useState(assetId || 'ALL')
  const [gAsset, setGAsset] = useState(assetId || '')
  const [gDid, setGDid] = useState('')
  const [perms, setPerms] = useState(['READ'])
  const [expiry, setExpiry] = useState('')
  const [modal, setModal] = useState(null)
  const [opId, setOpId] = useState(null)
  const op = useOp(opId)

  const rows = grants
    .filter((g) => scope === 'ALL' || g.assetId === scope)
    .map((g) => { const a = assets.find((x) => x.assetId === g.assetId); const expired = g.status === 'ACTIVE' && g.expiresAt < now(); return { ...g, assetName: a ? a.name : '?', display: g.status !== 'ACTIVE' ? g.status : expired ? 'EXPIRED' : 'ACTIVE' } })

  const beginOp = (type, payload, related) => {
    const id = startOperation({ type, label: type + (type === 'grant' ? ' access' : ' access'), relatedId: related, payload })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(type)
  }
  const submitGrant = () => {
    if (!gAsset || !gDid) return
    beginOp('grant', { id: uuid(), assetId: gAsset, granteeDid: gDid, permissions: perms, grantedAt: now(), expiresAt: expiry ? new Date(expiry).getTime() : now() + 30 * 86400000, status: 'ACTIVE' }, gAsset)
  }
  return (
    <div>
      <PageHead title='Access Management' sub={scope === 'ALL' ? 'cross-asset grant view' : 'grants for ' + (assets.find((a) => a.assetId === scope) || {}).name} />
      <div className='grid grid-cols-5 gap-3'>
        <div className='col-span-3'>
          <Panel pad={false} title='Grants' actions={
            <select className={selectCls + ' w-56 !py-0.5 text-[11px] font-mono'} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value='ALL'>ALL ASSETS</option>
              {assets.map((a) => <option key={a.assetId} value={a.assetId}>{a.name}</option>)}
            </select>
          }>
            {rows.length === 0 ? <div className='p-3'><EmptyState lines={['no access grants recorded']} /></div> : (
              <table className='w-full text-[12px]'>
                <thead><tr className='border-b border-steel-800 text-left'><th className='label-xs px-3 py-2'>Asset</th><th className='label-xs px-3 py-2'>Grantee DID</th><th className='label-xs px-3 py-2'>Perms</th><th className='label-xs px-3 py-2'>Expires</th><th className='label-xs px-3 py-2'>Status</th><th className='label-xs px-3 py-2'></th></tr></thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id} className={'border-b border-steel-900 last:border-b-0' + (g.display !== 'ACTIVE' ? ' opacity-40' : '')}>
                      <td className='px-3 py-2 text-steel-300'>{g.assetName}</td>
                      <td className='px-3 py-2'><CopyText value={g.granteeDid} /></td>
                      <td className='px-3 py-2 font-mono text-[10px] text-steel-400'>{g.permissions.join('/')}</td>
                      <td className='px-3 py-2 font-mono text-[11px] text-steel-500'>{fmtTime(g.expiresAt)}</td>
                      <td className='px-3 py-2'><Badge status={g.display} /></td>
                      <td className='px-3 py-2 text-right pr-3'>
                        {g.display === 'ACTIVE' && <Btn variant='danger' className='!px-2 !py-0.5' onClick={() => beginOp('revoke', g.id, g.assetId)}><Ban size={11} /> Revoke</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className='col-span-2 space-y-3'>
          <Panel title='Issue new grant'>
            <div className='space-y-3'>
              <Field label='Asset'><select className={selectCls} value={gAsset} onChange={(e) => setGAsset(e.target.value)}><option value=''>— select —</option>{assets.filter((a) => a.ownerDid === session.did).map((a) => <option key={a.assetId} value={a.assetId}>{a.name}</option>)}</select></Field>
              <Field label='Grantee DID'><select className={selectCls} value={gDid} onChange={(e) => setGDid(e.target.value)}><option value=''>— select —</option>{OTHER_DIDS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
              <div>
                <span className='label-xs block mb-1'>Permissions</span>
                <div className='flex gap-2'>
                  {PERMS.map((p) => (
                    <button key={p} onClick={() => setPerms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])} className={'font-mono text-[11px] border rounded px-2 py-1 transition-colors duration-150 ' + (perms.includes(p) ? 'border-accent text-accent-bright bg-accent-deep' : 'border-steel-700 text-steel-500')}>{p}</button>
                  ))}
                </div>
              </div>
              <Field label='Expires at (local time)'><input type='datetime-local' className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
              <Btn variant='primary' className='w-full justify-center' disabled={!gAsset || !gDid || perms.length === 0} onClick={submitGrant}><Plus size={12} /> Grant (step-up required)</Btn>
            </div>
            {op && <GrantOpLine id={op.id} />}
          </Panel>
        </div>
      </div>
      <StepUpModal open={!!modal} action={modal === 'grant' ? 'Grant access' : 'Revoke access'} onClose={() => setModal(null)} onComplete={() => { opAwaitSignature(opId); setModal(null) }} />
      {op && op.currentStep === 'AWAITING_SIGNATURE' && (
        <div className='fixed bottom-4 right-4 panel px-4 py-3 shadow-pop flex items-center gap-3 z-50'>
          <span className='font-mono text-[11px] text-steel-300'>Permit bound — submit transaction?</span>
          <Btn variant='primary' onClick={() => useStore.getState().opSubmit(op.id)}>Sign and submit</Btn>
        </div>
      )}
    </div>
  )
}