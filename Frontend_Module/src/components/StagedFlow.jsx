import { useEffect, useRef, useState } from 'react'
import { Fingerprint, PenLine, Play } from 'lucide-react'
import { useStore, useOp } from '../store'
import { fmtTime } from '../mock/api'
import { Badge, Btn, Stepper } from './ui'
import StepUpModal from './StepUpModal'

// Shared staged operation runner used by every wizard. Renders the one and
// only Stepper (same labels everywhere) driven by live op state.
export default function StagedFlow({ type, label, relatedId, payload, onConfirmed, hint }) {
  const [opId, setOpId] = useState(null)
  const [modal, setModal] = useState(false)
  const [permitOk, setPermitOk] = useState(false)
  const op = useOp(opId)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)
  const opSubmit = useStore((s) => s.opSubmit)
  const confirmedRef = useRef(false)

  useEffect(() => {
    if (op && op.result === 'success' && !confirmedRef.current) {
      confirmedRef.current = true
      onConfirmed && onConfirmed(op)
    }
  }, [op && op.result])

  const begin = () => {
    const id = startOperation({ type, label, relatedId, payload })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(true)
  }

  return (
    <div className='space-y-3'>
      <div className='panel p-3'>
        <div className='flex items-center justify-between mb-3'>
          <span className='label-xs'>Operation lifecycle</span>
          {op && <span className='font-mono text-[10px] text-steel-600'>op {op.id.slice(0, 8)}… / {fmtTime(op.updatedAt)}</span>}
        </div>
        {op ? (
          <>
            <Stepper op={op} />
            <div className='mt-3 text-[12px] text-steel-400'>
              {!permitOk && op.currentStep === 'AWAITING_STEP_UP' && <span>Complete step-up verification to bind the operation permit.</span>}
              {permitOk && op.currentStep === 'AWAITING_SIGNATURE' && <span>Permit bound. Submit the signed transaction to the registry.</span>}
              {op.currentStep === 'SUBMITTED' && <span className='text-warn'>Transaction submitted. Waiting for chain confirmation…</span>}
              {op.result === 'success' && <span className='text-ok'>Operation confirmed on-chain.</span>}
              {op.result === 'failure' && <span className='text-bad'>Operation failed ({op.failCode}). Nothing was applied; you may retry.</span>}
              {op.result === 'reorged' && <span className='text-bad'>A chain reorg reverted this confirmation. State shown honestly as REORGED.</span>}
            </div>
          </>
        ) : (
          <p className='font-mono text-[11px] text-steel-600'>{hint || 'Operation not started.'}</p>
        )}
        <div className='mt-3 flex items-center gap-2'>
          {!op && <Btn variant='primary' onClick={begin}><Play size={12} /> Begin operation</Btn>}
          {op && op.currentStep === 'AWAITING_STEP_UP' && !permitOk && <Btn variant='primary' onClick={() => setModal(true)}><Fingerprint size={12} /> Resume step-up</Btn>}
          {permitOk && op.currentStep === 'AWAITING_SIGNATURE' && <Btn variant='primary' onClick={() => opSubmit(op.id)}><PenLine size={12} /> Sign and submit</Btn>}
          {op && op.currentStep === 'SUBMITTED' && <span className='font-mono text-[10px] text-warn animate-pulseText'>POLLING CHAIN…</span>}
          {op && op.result === 'success' && <Badge status='CONFIRMED' />}
        </div>
      </div>
      <StepUpModal open={modal} action={label} onClose={() => setModal(false)} onComplete={() => { opAwaitSignature(opId); setPermitOk(true); setModal(false) }} />
    </div>
  )
}