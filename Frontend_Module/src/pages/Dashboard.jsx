import { Link } from 'react-router-dom'
import { Activity, Boxes, Share2, GitBranch, Plus, ArrowRight } from 'lucide-react'
import { useStore, useOp, useIdentity } from '../store'
import { fmtTime } from '../mock/api'
import { Badge, Btn, CopyText, EmptyState, Panel, PageHead, Stepper } from '../components/ui'

function OpCard({ id }) {
  const op = useOp(id)
  if (!op) return null
  return (
    <div className='px-3 py-2.5 border-b border-steel-900 last:border-b-0'>
      <div className='flex items-center justify-between mb-1.5'>
        <span className='font-mono text-[11px] text-steel-200'>{op.type.toUpperCase()} / {op.label}</span>
        {op.result ? <Badge status={op.currentStep} /> : <span className='font-mono text-[9px] text-warn animate-pulseText'>IN PROGRESS</span>}
      </div>
      <Stepper op={op} compact />
    </div>
  )
}

export default function Dashboard() {
  const session = useStore((s) => s.session)
  const identity = useIdentity(session ? session.did : null)
  const assets = useStore((s) => s.assets)
  const grants = useStore((s) => s.grants)
  const audits = useStore((s) => s.audits)
  const opOrder = useStore((s) => s.opOrder)
  const owned = assets.filter((a) => session?.did && a.ownerDid === session.did)
  const shared = grants.filter((g) => session?.did && g.granteeDid === session.did && g.status === 'ACTIVE')
  const ownedAssetIds = new Set(owned.map((a) => String(a.assetId)))
  const sharedAssetIds = new Set(shared.map((g) => String(g.assetId)))
  const allUserAssetIds = new Set([...ownedAssetIds, ...sharedAssetIds])

  const userAudits = audits.filter((a) => {
    if (!session?.did) return false
    if (a.actorDid && a.actorDid === session.did) return true
    if (a.target && (a.target === session.did || a.target.includes(session.did))) return true
    if (a.target && allUserAssetIds.has(String(a.target))) return true
    if (a.operationId && allUserAssetIds.has(String(a.operationId))) return true
    return false
  })

  const stats = [
    { icon: Activity, label: 'DID STATUS', value: identity ? identity.status : '-', badge: identity && identity.status },
    { icon: GitBranch, label: 'CURRENT ROOT', value: identity ? 'v' + identity.rootVersion : '-' },
    { icon: Boxes, label: 'OWNED ASSETS', value: String(owned.length) },
    { icon: Share2, label: 'SHARED WITH ME', value: String(shared.length) },
  ]
  return (
    <div>
      <PageHead title='Dashboard' sub={'overview / ' + (session?.did || 'did:platform:alcott.main')} actions={<Link to='/assets/upload'><Btn variant='primary'><Plus size={12} /> Mint asset</Btn></Link>} />
      <div className='grid grid-cols-4 gap-3 mb-4'>
        {stats.map((s) => (
          <div key={s.label} className='panel px-3 py-2.5'>
            <div className='flex items-center gap-1.5 mb-1.5'><s.icon size={12} className='text-steel-500' /><span className='label-xs'>{s.label}</span></div>
            {s.badge ? <Badge status={s.badge} /> : <span className='font-mono text-[18px] text-steel-100'>{s.value}</span>}
          </div>
        ))}
      </div>
      <div className='grid grid-cols-5 gap-3'>
        <div className='col-span-3 space-y-3'>
          <Panel title='In-progress operations' actions={<Link to='/audit' className='font-mono text-[10px] text-accent hover:text-accent-bright'>AUDIT LOG</Link>} pad={false}>
            {opOrder.length === 0 ? (
              <div className='p-3'><EmptyState lines={['no operations in this session', 'trigger a mint, update, transfer or grant to observe the staged lifecycle here']} /></div>
            ) : (
              <div className='divide-y divide-steel-900'>{opOrder.map((id) => <OpCard key={id} id={id} />)}</div>
            )}
          </Panel>
          <Panel title='Recent audit events' pad={false}>
            {userAudits.length === 0 ? (
              <div className='p-3'>
                <EmptyState lines={['no audit events recorded for this identity yet', 'mint an asset or execute an operation to generate audit trails']} />
              </div>
            ) : (
              <table className='w-full text-[12px]'>
                <tbody>
                  {userAudits.slice(0, 8).map((a) => (
                    <tr key={a.id} className='border-b border-steel-900 last:border-b-0'>
                      <td className='px-3 py-1.5 font-mono text-[11px] text-steel-400'>{fmtTime(a.at)}</td>
                      <td className='px-3 py-1.5 font-mono text-[11px] text-steel-200'>{a.action}</td>
                      <td className='px-3 py-1.5'><CopyText value={a.target} /></td>
                      <td className='px-3 py-1.5 text-right pr-3'><span className={a.result === 'success' ? 'font-mono text-[10px] text-ok' : 'font-mono text-[10px] text-bad'}>{a.result.toUpperCase()}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className='col-span-2 space-y-3'>
          <Panel title='Owned assets (latest)' pad={false}>
            {owned.length === 0 ? <div className='p-3'><EmptyState lines={['no assets registered for this identity']} /></div> : (
              <table className='w-full text-[12px]'>
                <tbody>
                  {owned.slice(0, 6).map((a) => (
                    <tr key={a.assetId} className='border-b border-steel-900 last:border-b-0 hover:bg-base-800 transition-colors duration-150'>
                      <td className='px-3 py-1.5'>
                        <Link to={'/assets/' + a.assetId} className='text-steel-200 hover:text-accent-bright'>{a.name}</Link>
                        <div className='font-mono text-[10px] text-steel-600'>v{a.documentVersion} / {a.status}</div>
                      </td>
                      <td className='px-3 py-1.5 text-right'><ArrowRight size={11} className='text-steel-600 inline' /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title='Identity summary'>
            <div className='space-y-1.5 text-[12px]'>
              <div className='flex justify-between'><span className='text-steel-500'>root version</span><span className='font-mono text-steel-200'>v{identity ? identity.rootVersion : '-'}</span></div>
              <div className='flex justify-between'><span className='text-steel-500'>active grants</span><span className='font-mono text-steel-200'>{grants.filter((g) => g.status === 'ACTIVE' && (g.granteeDid === session?.did || ownedAssetIds.has(String(g.assetId)))).length}</span></div>
              <div className='flex justify-between'><span className='text-steel-500'>inheritance</span><Link to='/inheritance' className='font-mono text-accent hover:text-accent-bright'>manage →</Link></div>
              <div className='flex justify-between'><span className='text-steel-500'>identity detail</span><Link to='/identity' className='font-mono text-accent hover:text-accent-bright'>open →</Link></div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}