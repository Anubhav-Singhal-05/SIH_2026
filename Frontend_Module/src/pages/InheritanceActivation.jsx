import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PenLine } from 'lucide-react'
import { useStore, useOp } from '../store'
import { Badge, Btn, KeyRow, PageHead, Panel, Stepper } from '../components/ui'
import StepUpModal from '../components/StepUpModal'

function OpLine({ id }) { const op = useOp(id); return op ? <div className='mt-2'><Stepper op={op} compact /></div> : null }

export default function InheritanceActivation() {
  const inheritance = useStore((s) => s.inheritance)
  const assets = useStore((s) => s.assets)
  const patchInheritance = useStore((s) => s.patchInheritance)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)
  const opSubmit = useStore((s) => s.opSubmit)
  const [modal, setModal] = useState(false)
  const [opId, setOpId] = useState(null)
  const op = useOp(opId)
  const timers = useRef([])

  const sigCount = inheritance.authoritySet.filter((a) => a.signed).length
  const canActivate = sigCount >= inheritance.signaturesRequired && inheritance.status !== 'ACTIVE' && inheritance.status !== 'CLOSED'

  // batch execution once ACTIVE
  useEffect(() => {
    if (inheritance.status === 'ACTIVE' && inheritance.batchProgress.length === 0) {
      const owned = assets.filter((a) => a.ownerDid && a.status === 'CONFIRMED')
      patchInheritance({ batchProgress: owned.map((a, i) => ({ assetId: a.assetId, name: a.name, state: 'PENDING' })) })
      owned.forEach((a, i) => {
        timers.current.push(setTimeout(() => patchInheritance({ batchProgress: useStore.getState().inheritance.batchProgress.map((b) => (b.assetId === a.assetId ? { ...b, state: 'EXECUTING' } : b)) }), 900 + i * 1400))
        timers.current.push(setTimeout(() => patchInheritance({ batchProgress: useStore.getState().inheritance.batchProgress.map((b) => (b.assetId === a.assetId ? { ...b, state: 'DONE' } : b)) }), 2100 + i * 1400))
      })
    }
  }, [inheritance.status])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const sign = (label) => patchInheritance({ authoritySet: inheritance.authoritySet.map((a) => (a.label === label ? { ...a, signed: true } : a)) })
  const activate = () => {
    patchInheritance({ status: 'ACTIVATING' })
    const id = startOperation({ type: 'inheritance_activate', label: 'activate inheritance', relatedId: inheritance.ownerDid })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(true)
  }
  const stateColor = { PENDING: 'text-steel-500', EXECUTING: 'text-warn animate-pulseText', DONE: 'text-ok' }
  return (
    <div>
      <PageHead
        title='Inheritance Activation + Status'
        sub='2-of-3 authority signature collection and batch execution'
        actions={<Link to='/inheritance' className='font-mono text-[10px] text-steel-500 hover:text-steel-200 border border-steel-700 rounded px-2 py-1'>&larr; SETUP</Link>}
      />
      <div className='grid grid-cols-5 gap-3 max-w-[1200px]'>
        <div className='col-span-3 space-y-3'>
          <Panel title='Authority signature collection' actions={<Badge status={inheritance.status} />}>
            <div className='space-y-2'>
              {inheritance.authoritySet.map((a) => (
                <div key={a.label} className='flex items-center justify-between inset-panel px-3 py-2'>
                  <div>
                    <div className='font-mono text-[11px] text-steel-200'>{a.label}</div>
                    <div className='font-mono text-[10px] text-steel-600'>{a.did}</div>
                  </div>
                  {a.signed ? <Badge status='CONFIRMED' /> : <Btn className='!py-1' onClick={() => sign(a.label)} disabled={inheritance.status === 'ACTIVE'}><PenLine size={11} /> Simulate authority signing</Btn>}
                </div>
              ))}
            </div>
            <p className='font-mono text-[11px] text-steel-400 mt-3'>&gt; {sigCount} of {inheritance.signaturesRequired} required signatures collected</p>
            {sigCount >= inheritance.signaturesRequired && inheritance.status !== 'ACTIVE' && <p className='font-mono text-[11px] text-ok mt-1'>&gt; quorum reached / activation available</p>}
          </Panel>
          <Panel title='Batch execution per asset' pad={false}>
            {inheritance.status !== 'ACTIVE' ? (
              <div className='px-3 py-3 font-mono text-[11px] text-steel-600'>&gt; batch list appears after activation</div>
            ) : (
              <table className='w-full text-[12px]'>
                <thead><tr className='border-b border-steel-800 text-left'><th className='label-xs px-3 py-2'>Asset</th><th className='label-xs px-3 py-2'>State</th></tr></thead>
                <tbody>
                  {inheritance.batchProgress.map((b) => (
                    <tr key={b.assetId} className='border-b border-steel-900 last:border-b-0'>
                      <td className='px-3 py-2 text-steel-300'>{b.name}</td>
                      <td className='px-3 py-2 font-mono text-[11px]'><span className={stateColor[b.state]}>{b.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className='col-span-2 space-y-3'>
          <Panel title='Activation'>
            <KeyRow k='Rule status'><Badge status={inheritance.status} /></KeyRow>
            <KeyRow k='Nominee'><span className='font-mono text-[12px]'>{inheritance.defaultNomineeDid}</span></KeyRow>
            <KeyRow k='Overrides'><span className='font-mono text-[12px]'>{inheritance.perAssetOverrides.length}</span></KeyRow>
            <Btn variant='primary' className='w-full justify-center mt-3' disabled={!canActivate} onClick={activate}>
              {inheritance.status === 'ACTIVE' ? 'Inheritance active' : canActivate ? 'Activate via step-up' : 'Quorum not reached'}
            </Btn>
            <p className='text-[11px] text-steel-500 mt-2 leading-relaxed'>Activation moves the rule to ACTIVE after chain confirmation and schedules batch execution over every confirmed asset.</p>
            {op && <OpLine id={op.id} />}
          </Panel>
        </div>
      </div>
      <StepUpModal open={modal} action='Activate inheritance' onClose={() => setModal(false)} onComplete={() => { opAwaitSignature(opId); setModal(false) }} />
      {op && op.currentStep === 'AWAITING_SIGNATURE' && (
        <div className='fixed bottom-4 right-4 panel px-4 py-3 shadow-pop flex items-center gap-3 z-50'>
          <span className='font-mono text-[11px] text-steel-300'>Permit bound — submit transaction?</span>
          <Btn variant='primary' onClick={() => opSubmit(op.id)}>Sign and submit</Btn>
        </div>
      )}
    </div>
  )
}