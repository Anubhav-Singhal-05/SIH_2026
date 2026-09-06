import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Boxes, KeyRound, Users, Fingerprint, ScrollText, Bell, Wrench, LogOut, X, RefreshCcw, CircleDot, ShieldCheck, RotateCcw, TriangleAlert } from 'lucide-react'
import { useStore, useOp } from '../store'
import { Stepper, CopyText, Badge } from './ui'
import { fmtTime } from '../mock/api'
import { ReorgBanner } from './Banners'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/access', label: 'Access', icon: KeyRound },
  { to: '/inheritance', label: 'Inheritance', icon: Users },
  { to: '/identity', label: 'Identity', icon: Fingerprint },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
]

const INJECTABLE = ['STALE_ROOT', 'PERMIT_EXPIRED', 'CONTRACT_REVERTED', 'CHAIN_UNAVAILABLE', 'RATE_LIMITED', 'STORAGE_FINALIZATION_FAILED', 'IDEMPOTENCY_CONFLICT']

function OpRow({ id }) {
  const op = useOp(id)
  if (!op) return null
  return (
    <div className='px-3 py-2.5 border-b border-steel-900 last:border-b-0'>
      <div className='flex items-center justify-between mb-1.5'>
        <span className='font-mono text-[11px] text-steel-200'>{op.type.toUpperCase()} / {op.label}</span>
        {op.result ? <Badge status={op.currentStep} /> : <span className='font-mono text-[9px] text-warn animate-pulseText'>LIVE</span>}
      </div>
      <Stepper op={op} compact />
      <div className='mt-1 font-mono text-[9px] text-steel-600'>related: {op.relatedId ? String(op.relatedId).slice(0, 18) + '…' : '-'} / updated {fmtTime(op.updatedAt)}</div>
    </div>
  )
}

export function OpsSlideOver() {
  const open = useStore((s) => s.opsOpen)
  const setOpsOpen = useStore((s) => s.setOpsOpen)
  const opOrder = useStore((s) => s.opOrder)
  if (!open) return null
  return (
    <div className='fixed inset-0 z-40'>
      <div className='absolute inset-0 bg-black/50' onClick={() => setOpsOpen(false)} />
      <aside className='absolute right-0 top-0 bottom-0 w-[440px] bg-base-850 border-l border-steel-800 shadow-pop flex flex-col'>
        <header className='flex items-center justify-between px-4 py-3 border-b border-steel-800'>
          <div className='flex items-center gap-2'><Bell size={14} className='text-accent' /><span className='label-xs'>Operations Monitor</span></div>
          <button onClick={() => setOpsOpen(false)} className='text-steel-500 hover:text-steel-200'><X size={14} /></button>
        </header>
        <div className='flex-1 overflow-y-auto'>
          {opOrder.length === 0 ? (
            <div className='p-4 font-mono text-[11px] text-steel-600 space-y-1'>
              <div>&gt; no operations in this session</div>
              <div>&gt; mint / update / transfer / grant / inheritance actions appear here live</div>
            </div>
          ) : (
            <div className='divide-y divide-steel-900'>{opOrder.map((id) => <OpRow key={id} id={id} />)}</div>
          )}
        </div>
      </aside>
    </div>
  )
}

export function DemoMenu() {
  const [open, setOpen] = useState(false)
  const triggerReorg = useStore((s) => s.triggerReorg)
  const setInjectNext = useStore((s) => s.setInjectNext)
  const injectNext = useStore((s) => s.injectNext)
  return (
    <div className='relative'>
      <button onClick={() => setOpen(!open)} className='flex items-center gap-1.5 border border-steel-700 rounded px-2 py-1 text-[11px] font-mono text-steel-400 hover:text-steel-100 hover:border-steel-500 transition-colors duration-150'><Wrench size={11} /> DEMO</button>
      {open && (
        <div className='absolute right-0 mt-1 w-[300px] panel shadow-pop z-50'>
          <div className='px-3 py-2 border-b border-steel-800 label-xs'>Fault injection console</div>
          <div className='p-2 space-y-1'>
            <button onClick={() => { triggerReorg(); setOpen(false) }} className='w-full text-left px-2 py-1.5 rounded hover:bg-base-800 flex items-center gap-2 font-mono text-[11px] text-steel-300'><RefreshCcw size={11} className='text-bad' /> Trigger chain reorg</button>
            <div className='px-2 pt-1 pb-0.5 label-xs'>Inject next failure</div>
            {INJECTABLE.map((c) => (
              <button key={c} onClick={() => { setInjectNext(c); setOpen(false) }} className='w-full text-left px-2 py-1 rounded hover:bg-base-800 font-mono text-[10px] text-steel-400'>{c}{injectNext === c ? ' • armed' : ''}</button>
            ))}
            {injectNext && <button onClick={() => setInjectNext(null)} className='w-full text-left px-2 py-1 font-mono text-[10px] text-bad'>disarm injection</button>}
          </div>
        </div>
      )}
    </div>
  )
}
export default function Shell({ children }) {
  const navigate = useNavigate()
  const session = useStore((s) => s.session)
  const logout = useStore((s) => s.logout)
  const setOpsOpen = useStore((s) => s.setOpsOpen)
  const identity = useStore((s) => s.identities.find((i) => i.did === (session && session.did)))
  const activeCount = useStore((s) => s.opOrder.reduce((n, id) => { const o = s.opsById[id]; return n + (o && !o.result ? 1 : 0) }, 0))
  const reorg = useStore((s) => s.reorg)

  return (
    <div className='min-h-screen flex flex-col'>
      {reorg.visible && <ReorgBanner />}
      <div className='flex flex-1 min-h-0'>
        <aside className='w-52 shrink-0 border-r border-steel-800 bg-base-850 flex flex-col'>
          <div className='px-4 py-4 border-b border-steel-800'>
            <div className='flex items-center gap-2'>
              <div className='w-6 h-6 border border-accent rounded-sm flex items-center justify-center'>
                <div className='w-2 h-2 bg-accent rounded-full' />
              </div>
              <div>
                <div className='text-[12px] font-semibold tracking-[0.18em] text-steel-100'>AEGIS</div>
                <div className='text-[9px] tracking-[0.22em] text-steel-500'>REGISTRY CONSOLE</div>
              </div>
            </div>
          </div>
          <nav className='flex-1 py-2'>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => 'flex items-center gap-2.5 px-4 py-2 text-[12px] border-l-2 transition-colors duration-150 ' + (isActive ? 'border-accent text-steel-100 bg-base-800' : 'border-transparent text-steel-400 hover:text-steel-200 hover:bg-base-800/60')}>
                <n.icon size={13} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className='px-4 py-3 border-t border-steel-800 font-mono text-[9px] text-steel-600 leading-relaxed'>
            <div>chain 31337 / localnet</div>
            <div>registry v1.0.0</div>
          </div>
        </aside>
        <div className='flex-1 flex flex-col min-w-0'>
          <header className='h-11 shrink-0 border-b border-steel-800 bg-base-850 flex items-center gap-4 px-5'>
            <div className='flex items-center gap-2'>
              <span className='label-xs'>DID</span>
              <CopyText value={session ? session.did : '-'} />
            </div>
            <div className='flex items-center gap-1.5 border border-steel-800 rounded px-2 py-0.5 bg-base-900'>
              <CircleDot size={10} className={'text-ok'} />
              <span className='font-mono text-[10px] text-steel-400 tracking-wider'>CHAIN 31337 / LOCALNET</span>
            </div>
            <div className='ml-auto flex items-center gap-2'>
              <DemoMenu />
              <button onClick={() => setOpsOpen(true)} className='relative border border-steel-700 rounded p-1.5 text-steel-400 hover:text-steel-100 hover:border-steel-500 transition-colors duration-150'>
                <Bell size={13} />
                {activeCount > 0 && <span className='absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-sm bg-accent text-base-950 font-mono text-[9px] leading-[14px] text-center font-semibold'>{activeCount}</span>}
              </button>
              <button onClick={() => { logout(); navigate('/login') }} className='flex items-center gap-1.5 border border-steel-700 rounded px-2 py-1 text-[11px] font-mono text-steel-400 hover:text-steel-100 hover:border-steel-500 transition-colors duration-150'><LogOut size={11} /> END SESSION</button>
            </div>
          </header>
          <main className='flex-1 overflow-y-auto p-5 max-w-[1400px] w-full mx-auto'>{children}</main>
        </div>
      </div>
      <OpsSlideOver />
    </div>
  )
}
