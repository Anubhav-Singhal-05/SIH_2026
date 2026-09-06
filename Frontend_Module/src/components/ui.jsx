import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { STEP_ORDER } from '../store'

const BADGE = {
  CONFIRMED: 'text-ok border-ok bg-base-950', ACTIVE: 'text-ok border-ok bg-base-950', VERIFIED: 'text-ok border-ok bg-base-950',
  STAGED: 'text-warn border-warn bg-base-950', PENDING: 'text-warn border-warn bg-base-950', AWAITING_STEP_UP: 'text-warn border-warn bg-base-950', AWAITING_SIGNATURE: 'text-warn border-warn bg-base-950', SUBMITTED: 'text-warn border-warn bg-base-950', ACTIVATING: 'text-warn border-warn bg-base-950',
  FAILED: 'text-bad border-bad bg-base-950', REORGED: 'text-bad border-bad bg-base-950', REVERTED: 'text-bad border-bad bg-base-950',
  DEACTIVATED: 'text-idle border-idle bg-base-950', SUSPENDED: 'text-idle border-idle bg-base-950', EXPIRED: 'text-idle border-idle bg-base-950', REVOKED: 'text-idle border-idle bg-base-950', INACTIVE: 'text-idle border-idle bg-base-950',
  CONFIGURED: 'text-accent border-accent bg-base-950',
}
export function Badge({ status, className = '' }) {
  return <span className={'inline-flex items-center rounded-sm border px-1.5 py-px text-[10px] font-mono tracking-wider bg-base-950 ' + (BADGE[status] || 'text-steel-400 border-steel-600') + ' ' + className}>{status}</span>
}

export function Btn({ variant = 'ghost', className = '', children, ...rest }) {
  const v = variant === 'primary' ? 'bg-accent border-accent text-base-950 hover:bg-accent-bright hover:border-accent-bright' : variant === 'danger' ? 'border-bad text-bad hover:bg-bad hover:text-base-950' : 'border-steel-700 text-steel-300 hover:border-steel-500 hover:text-steel-100 bg-base-800'
  return <button className={'btn-base ' + v + ' ' + className} {...rest}>{children}</button>
}

export function CopyText({ value, full = false, className = '' }) {
  const [copied, setCopied] = useState(false)
  const disp = full || !value ? value : value.length <= 22 ? value : value.slice(0, 12) + '…' + value.slice(-6)
  const doCopy = () => { if (navigator.clipboard) navigator.clipboard.writeText(value || ''); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  return (
    <span className={'inline-flex items-center gap-1 font-mono text-[12px] text-steel-300 ' + className}>
      <span className={'overflow-hidden text-ellipsis whitespace-nowrap'} title={value}>{disp}</span>
      <button onClick={doCopy} className={'text-steel-600 hover:text-accent transition-colors duration-150'} title={'Copy'}>{copied ? <Check size={11} className={'text-ok'} /> : <Copy size={11} />}</button>
    </span>
  )
}

export function Panel({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={'panel ' + className}>
      {(title || actions) && (
        <header className='flex items-center justify-between border-b border-steel-800 px-3 py-2'>
          <h2 className='label-xs'>{title}</h2>
          <div className='flex items-center gap-2'>{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-3' : ''}>{children}</div>
    </section>
  )
}

export function KeyRow({ k, children }) {
  return (
    <div className='flex items-start gap-3 py-1.5 border-b border-steel-900 last:border-b-0'>
      <span className='label-xs w-48 shrink-0 pt-0.5'>{k}</span>
      <span className='text-[13px] text-steel-200 min-w-0 break-all'>{children}</span>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className='block'>
      <span className='label-xs block mb-1'>{label}</span>
      {children}
    </label>
  )
}

export const inputCls = 'w-full bg-base-950 border border-steel-700 rounded px-2 py-1.5 text-[13px] text-steel-200 font-mono focus:outline-none focus:border-accent transition-colors duration-150'
export const selectCls = inputCls + ' pr-6'

export function Stepper({ op, compact = false }) {
  if (!op) return null
  const step = op.currentStep
  const failed = step === 'FAILED' || step === 'REORGED' || op.result === 'failure' || op.result === 'reorged'
  const idx = failed ? 4 : STEP_ORDER.indexOf(step)
  return (
    <div className={'flex items-center ' + (compact ? 'gap-1' : 'gap-2') + ' flex-wrap'}>
      {STEP_ORDER.map((s, i) => {
        const done = i < idx
        const cur = i === idx && !failed
        const dot = done ? 'bg-accent border-accent' : cur ? 'border-accent bg-accent-deep animate-pulseText' : failed && i === 4 ? 'bg-bad border-bad' : 'border-steel-700 bg-base-950'
        const txt = failed && i === 4 ? (step === 'REORGED' ? 'text-bad' : 'text-bad') : done ? 'text-steel-200' : cur ? 'text-accent-bright' : 'text-steel-600'
        return (
          <span key={s} className='inline-flex items-center'>
            {i > 0 && <span className={'w-3 border-t border-steel-800 mx-1'} />}
            <span className='inline-flex items-center gap-1.5'>
              <span className={'w-1.5 h-1.5 rounded-full border ' + dot} />
              <span className={'font-mono text-[10px] tracking-wider ' + txt}>{s}</span>
            </span>
          </span>
        )
      })}
      {failed && <Badge status={step} className='ml-1' />}
    </div>
  )
}

export function SkeletonRows({ cols = 5, rows = 5 }) {
  return (
    <div className='divide-y divide-steel-900'>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className='flex items-center gap-4 py-2.5 px-3'>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className='skeleton h-3 rounded-sm' style={{ width: (c === 0 ? 18 : 12) + 'ch', maxWidth: (c === 0 ? '180px' : '120px') }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ lines = [] }) {
  return (
    <div className='inset-panel px-4 py-6 font-mono text-[12px] text-steel-500'>
      {lines.map((l, i) => (
        <div key={i} className='flex gap-2'><span className='text-accent-dim'>&gt;</span><span>{l}</span></div>
      ))}
    </div>
  )
}

export function PageHead({ title, sub, actions }) {
  return (
    <div className='flex items-end justify-between mb-4'>
      <div>
        <h1 className='text-[15px] font-semibold text-steel-100 tracking-wide uppercase'>{title}</h1>
        {sub && <p className='text-[12px] text-steel-500 mt-0.5 font-mono'>{sub}</p>}
      </div>
      <div className='flex items-center gap-2'>{actions}</div>
    </div>
  )
}