import { useEffect, useMemo, useState } from 'react'
import { Fingerprint, PenLine, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../store'
import { hex, sleep, ERROR_COPY } from '../mock/api'
import { Badge, Btn, CopyText } from './ui'

// Reusable step-up verification flow: passkey verify, wallet sign with fake
// calldata preview, confirmation wait, result. Used by every sensitive action.
export default function StepUpModal({ open, action, onClose, onComplete }) {
  const [phase, setPhase] = useState('passkey')
  const [failCode, setFailCode] = useState(null)
  const injectNext = useStore((s) => s.injectNext)
  const setInjectNext = useStore((s) => s.setInjectNext)
  const calldata = useMemo(() => '0x' + hex(180), [open])
  const txHash = useMemo(() => '0x' + hex(64), [open])
  const permitHash = useMemo(() => '0x' + hex(64), [open])

  useEffect(() => { if (open) { setPhase('passkey'); setFailCode(null) } }, [open])

  if (!open) return null
  const finish = async () => {
    setPhase('waiting')
    await sleep(1400 + Math.random() * 900)
    if (injectNext) { setFailCode(injectNext); setInjectNext(null); setPhase('done-fail'); return }
    setPhase('done')
    await sleep(700)
    onComplete()
  }
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70'>
      <div className='w-[560px] panel shadow-pop'>
        <header className='flex items-center justify-between border-b border-steel-800 px-4 py-2.5'>
          <div className='flex items-center gap-2'>
            <ShieldCheck size={14} className='text-accent' />
            <span className='label-xs'>Step-Up Verification / {action}</span>
          </div>
          <button onClick={onClose} className='text-steel-500 hover:text-steel-200'><X size={14} /></button>
        </header>
        <div className='px-4 py-4 space-y-4'>
          <div className='flex items-center gap-2 font-mono text-[10px] tracking-wider'>
            {['PASSKEY', 'WALLET SIGN', 'CONFIRM', 'RESULT'].map((s, i) => (
              <span key={s} className='flex items-center gap-1'>
                {i > 0 && <span className='w-2 border-t border-steel-800' />}
                <span className={(i === 0 && phase !== 'passkey') || (i === 1 && ['waiting', 'done', 'done-fail'].includes(phase)) || (i === 2 && ['done', 'done-fail'].includes(phase)) ? 'text-steel-200' : ((i === 0 && phase === 'passkey') || (i === 1 && phase === 'sign') || (i === 2 && phase === 'waiting')) ? 'text-accent-bright' : 'text-steel-600'}>{i + 1} {s}</span>
              </span>
            ))}
          </div>

          {phase === 'passkey' && (
            <div className='space-y-3'>
              <p className='text-[12px] text-steel-400'>A short-lived, single-use permit is required for this on-chain write. Verify your identity with the device passkey bound to your DID session.</p>
              <Btn variant='primary' onClick={async () => { setPhase('waiting'); await sleep(900); setPhase('sign') }}><Fingerprint size={13} /> Verify with passkey</Btn>
            </div>
          )}

          {phase === 'sign' && (
            <div className='space-y-3'>
              <p className='text-[12px] text-steel-400'>Sign the step-up permit with your controller wallet. Permit expires in 60s and is single-use.</p>
              <div className='inset-panel p-2.5 space-y-1.5'>
                <div className='flex justify-between text-[11px]'><span className='label-xs'>permit.operationHash</span><CopyText value={permitHash} /></div>
                <div className='flex justify-between text-[11px]'><span className='label-xs'>target</span><span className='font-mono text-[12px] text-steel-400'>AssetRegistry.registerAsset</span></div>
                <div><span className='label-xs block'>calldata preview</span><p className='font-mono text-[10px] text-steel-500 break-all leading-relaxed mt-1'>{calldata.slice(0, 178)}…</p></div>
              </div>
              <Btn variant='primary' onClick={finish}><PenLine size={13} /> Sign with wallet</Btn>
            </div>
          )}

          {phase === 'waiting' && (
            <div className='py-6 text-center'>
              <p className='font-mono text-[12px] text-accent-bright animate-pulseText tracking-widest'>AWAITING CONFIRMATION</p>
              <p className='font-mono text-[10px] text-steel-600 mt-2'>do not close this window / tx {txHash.slice(0, 14)}…</p>
            </div>
          )}

          {phase === 'done' && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'><Badge status='CONFIRMED' /><span className='text-[12px] text-steel-300'>Step-up permit acquired. Proceeding with the operation.</span></div>
              <div className='flex justify-between'><span className='label-xs'>permit.signature</span><CopyText value={'0x' + hex(128)} /></div>
            </div>
          )}

          {phase === 'done-fail' && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'><Badge status='FAILED' /><span className='font-mono text-[11px] text-bad'>{failCode}</span></div>
              <p className='text-[12px] text-steel-400'>{ERROR_COPY[failCode]}</p>
              <div className='flex gap-2'>
                <Btn onClick={() => { setPhase('sign'); setFailCode(null) }}>Retry signature</Btn>
                <Btn onClick={onClose}>Abort</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}