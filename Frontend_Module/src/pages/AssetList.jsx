import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ArrowRight, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useStore } from '../store'
import { fmtTime } from '../mock/api'
import { Badge, Btn, CopyText, EmptyState, PageHead, Panel, SkeletonRows, selectCls } from '../components/ui'

const STATUSES = ['ALL', 'CONFIRMED', 'STAGED', 'DEACTIVATED']

export default function AssetList() {
  const session = useStore((s) => s.session)
  const assets = useStore((s) => s.assets)
  const grants = useStore((s) => s.grants)
  const [status, setStatus] = useState('ALL')
  const [ownership, setOwnership] = useState('OWNED')
  const [loading, setLoading] = useState(true)

  useEffect(() => { const t = setTimeout(() => setLoading(false), 650); return () => clearTimeout(t) }, [])

  const sharedIds = new Set(grants.filter((g) => g.granteeDid === session.did).map((g) => g.assetId))
  const rows = assets
    .filter((a) => (ownership === 'OWNED' ? a.ownerDid === session.did : ownership === 'SHARED' ? sharedIds.has(a.assetId) : true))
    .filter((a) => status === 'ALL' || a.status === status)

  return (
    <div>
      <PageHead
        title='Assets'
        sub='registered document assets bound to did merkle roots'
        actions={<Link to='/assets/upload'><Btn variant='primary'><Plus size={12} /> Mint asset</Btn></Link>}
      />
      <div className='flex items-center gap-3 mb-3'>
        <select className={selectCls + ' w-44'} value={ownership} onChange={(e) => setOwnership(e.target.value)}>
          <option value='OWNED'>OWNED BY ME</option>
          <option value='SHARED'>SHARED WITH ME</option>
          <option value='ALL'>ALL VISIBLE</option>
        </select>
        <select className={selectCls + ' w-44'} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className='font-mono text-[10px] text-steel-600 ml-auto'>{rows.length} records</span>
      </div>
      <Panel pad={false}>
        {loading ? (
          <SkeletonRows cols={5} rows={7} />
        ) : rows.length === 0 ? (
          <div className='p-3'><EmptyState lines={['no assets match the current filter', 'adjust filters or mint a new asset']} /></div>
        ) : (
          <table className='w-full text-[12px]'>
            <thead>
              <tr className='border-b border-steel-800 text-left'>
                <th className='label-xs px-3 py-2'>Asset ID</th>
                <th className='label-xs px-3 py-2'>Name / Type</th>
                <th className='label-xs px-3 py-2'>Status</th>
                <th className='label-xs px-3 py-2'>Owner DID</th>
                <th className='label-xs px-3 py-2'>Updated</th>
                <th className='label-xs px-3 py-2'></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.assetId} className='border-b border-steel-900 last:border-b-0 hover:bg-base-800 transition-colors duration-150'>
                  <td className='px-3 py-2'><CopyText value={a.assetId} /></td>
                  <td className='px-3 py-2'>
                    <span className='text-steel-200'>{a.name}</span>
                    <span className='block font-mono text-[10px] text-steel-600'>{a.contentType} / v{a.documentVersion}</span>
                  </td>
                  <td className='px-3 py-2'><Badge status={a.status} /></td>
                  <td className='px-3 py-2 font-mono text-[11px] text-steel-400'>{a.ownerDid === session.did ? '(self)' : a.ownerDid}</td>
                  <td className='px-3 py-2 font-mono text-[11px] text-steel-500'>{fmtTime(a.updatedAt)}</td>
                  <td className='px-3 py-2 text-right pr-3'><Link to={'/assets/' + a.assetId} className='text-accent hover:text-accent-bright inline-flex items-center gap-1 font-mono text-[11px]'>OPEN <ArrowRight size={11} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}