import { AlertTriangle, RefreshCcw, X, ShieldAlert } from 'lucide-react'
import { useStore } from '../store'
import { ERROR_COPY } from '../mock/api'
import { CopyText } from './ui'

export function ErrorBanner() {
  const errors = useStore((s) => s.errors)
  const dismissError = useStore((s) => s.dismissError)
  if (!errors.length) return null
  return (
    <div className='fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[680px] space-y-2'>
      {errors.map((e) => (
        <div key={e.id} className='panel border-bad bg-base-850 flex items-start gap-2.5 px-3 py-2.5 shadow-pop'>
          <ShieldAlert size={14} className='text-bad mt-0.5 shrink-0' />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span className='font-mono text-[11px] font-semibold text-bad tracking-wider'>{e.code}</span>
              <span className='font-mono text-[10px] text-steel-600'>requestId</span>
              <CopyText value={e.requestId} />
            </div>
            <p className='text-[12px] text-steel-300 mt-1 leading-relaxed'>{ERROR_COPY[e.code]}</p>
          </div>
          <button onClick={() => dismissError(e.id)} className='text-steel-600 hover:text-steel-200 shrink-0'><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}

export function ReorgBanner() {
  const reorg = useStore((s) => s.reorg)
  const dismissReorg = useStore((s) => s.dismissReorg)
  if (!reorg.visible) return null
  return (
    <div className='border-b border-bad bg-base-850'>
      <div className='max-w-[1400px] mx-auto px-5 py-2 flex items-center gap-2.5'>
        <RefreshCcw size={13} className='text-bad shrink-0' />
        <span className='font-mono text-[11px] text-bad tracking-wider'>REORG_IN_PROGRESS</span>
        <span className='text-[12px] text-steel-300'>A previously confirmed operation was reverted due to a chain reorganization. Its state is now marked REORGED and will be re-queued for resubmission.</span>
        <div className='ml-auto flex items-center gap-2'>
          <button onClick={dismissReorg} className='font-mono text-[10px] text-steel-500 hover:text-steel-200 border border-steel-700 px-2 py-0.5 rounded transition-colors duration-150'>DISMISS</button>
        </div>
      </div>
    </div>
  )
}