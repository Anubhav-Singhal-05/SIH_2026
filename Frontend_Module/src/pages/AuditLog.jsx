import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { fmtTime } from '../mock/api'
import { CopyText, EmptyState, PageHead, Panel, SkeletonRows, selectCls, inputCls } from '../components/ui'

const ACTIONS = ['ALL', 'mint_intent', 'mint_confirmed', 'document_update', 'transfer', 'grant_created', 'grant_revoked', 'controller_rotated', 'inheritance_configured', 'chain_reorg', 'asset_deactivated']

export default function AuditLog() {
  const audits = useStore((s) => s.audits)
  const [action, setAction] = useState('ALL')
  const [result, setResult] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { const t = setTimeout(() => setLoading(false), 600); return () => clearTimeout(t) }, [])
  const rows = useMemo(() => audits.filter((a) => (action === 'ALL' || a.action === action) && (result === 'ALL' || a.result === result) && (!from || a.at >= new Date(from).getTime()) && (!to || a.at <= new Date(to).getTime() + 86400000)), [audits, action, result, from, to])

  return (
    <div>
      <PageHead title='Audit Log' sub='immutable event trail / every mutation produces an audit record' />
      <div className='flex items-center gap-3 mb-3'>
        <select className={selectCls + ' w-56'} value={action} onChange={(e) => setAction(e.target.value)}>{ACTIONS.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}</select>
        <select className={selectCls + ' w-36'} value={result} onChange={(e) => setResult(e.target.value)}><option value='ALL'>ALL RESULTS</option><option value='success'>SUCCESS</option><option value='failure'>FAILURE</option></select>
        <input type='date' className={inputCls + ' w-40'} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type='date' className={inputCls + ' w-40'} value={to} onChange={(e) => setTo(e.target.value)} />
        <span className='font-mono text-[10px] text-steel-600 ml-auto'>{rows.length} events</span>
      </div>
      <Panel pad={false}>
        {loading ? <SkeletonRows cols={5} rows={8} /> : rows.length === 0 ? <div className='p-3'><EmptyState lines={['no audit events match the current filters']} /></div> : (
          <table className='w-full text-[12px]'>
            <thead>
              <tr className='border-b border-steel-800 text-left'>
                <th className='label-xs px-3 py-2 w-8'></th>
                <th className='label-xs px-3 py-2'>Timestamp</th>
                <th className='label-xs px-3 py-2'>Actor DID hash</th>
                <th className='label-xs px-3 py-2'>Action</th>
                <th className='label-xs px-3 py-2'>Target</th>
                <th className='label-xs px-3 py-2'>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <FragmentRow key={a.id} a={a} open={openId === a.id} toggle={() => setOpenId(openId === a.id ? null : a.id)} />
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

function FragmentRow({ a, open, toggle }) {
  return (
    <>
      <tr onClick={toggle} className='border-b border-steel-900 cursor-pointer hover:bg-base-800 transition-colors duration-150'>
        <td className='px-3 py-2 text-steel-600'>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
        <td className='px-3 py-2 font-mono text-[11px] text-steel-500'>{fmtTime(a.at)}</td>
        <td className='px-3 py-2'><CopyText value={a.actorDidHash} /></td>
        <td className='px-3 py-2 font-mono text-[11px] text-steel-200'>{a.action}</td>
        <td className='px-3 py-2'><CopyText value={a.target} /></td>
        <td className='px-3 py-2 pr-3'><span className={a.result === 'success' ? 'font-mono text-[10px] text-ok' : 'font-mono text-[10px] text-bad'}>{a.result.toUpperCase()}</span></td>
      </tr>
      {open && (
        <tr className='border-b border-steel-900 bg-base-950'>
          <td className='px-3 py-3'></td>
          <td colSpan='5' className='py-3 pr-6 font-mono text-[11px] text-steel-500 space-y-1'>
            <div>requestId: <CopyText value={a.requestId} className='inline-flex' /></div>
            <div>operationId: {a.operationId ? <CopyText value={a.operationId} className='inline-flex' /> : <span>—</span>}</div>
            <div>actorDidHash (full): <CopyText value={a.actorDidHash} full className='inline-flex' /></div>
            <div className='text-steel-600'>&gt; event recorded by the backend pipeline; entries are append-only</div>
          </td>
        </tr>
      )}
    </>
  )
}