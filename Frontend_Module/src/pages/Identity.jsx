import { useState } from 'react'
import { ShieldOff, Power, RefreshCcw } from 'lucide-react'
import { useStore, useIdentity } from '../store'
import { fmtTime, hex64 } from '../mock/api'
import { Badge, Btn, CopyText, KeyRow, Panel, PageHead, SkeletonRows } from '../components/ui'
import StepUpModal from '../components/StepUpModal'
import { useOp } from '../store'
import { Stepper } from '../components/ui'

const ACTIONS = [
  { key: 'rotate', label: 'Rotate controller', icon: RefreshCcw, op: 'rotate' },
  { key: 'suspend', label: 'Suspend identity', icon: ShieldOff, op: 'suspend' },
  { key: 'deactivate', label: 'Deactivate identity', icon: Power, op: 'deactivate' },
]

function OpLine({ id }) { const op = useOp(id); return op ? <div className='mt-2'><Stepper op={op} compact /></div> : null }

export default function Identity() {
  const session = useStore((s) => s.session)
  const identity = useIdentity(session.did)
  const [modal, setModal] = useState(null)
  const [opId, setOpId] = useState(null)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)
  const op = useOp(opId)

  const run = (key) => {
    const id = startOperation({ type: key, label: key + ' identity', relatedId: session.did })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(key)
  }

  return (
    <div>
      <PageHead title='My Identity' sub='decentralized identifier detail and root lineage' />
      <div className='grid grid-cols-5 gap-3'>
        <div className='col-span-3 space-y-3'>
          <Panel title='DID record' actions={identity && <Badge status={identity.status} />}>
            <KeyRow k='DID'><CopyText value={session.did} full /></KeyRow>
            <KeyRow k='Controller address'><CopyText value={identity ? identity.controllerAddress : ''} /></KeyRow>
            <KeyRow k='Encryption key fingerprint'><CopyText value={identity ? identity.encryptionKeyFingerprint : ''} /></KeyRow>
            <KeyRow k='Root version'><span className='font-mono'>v{identity ? identity.rootVersion : '-'}</span></KeyRow>
          </Panel>
          <Panel title='Root version history' pad={false}>
            <table className='w-full text-[12px]'>
              <thead>
                <tr className='border-b border-steel-800 text-left'>
                  <th className='label-xs px-3 py-2'>Version</th>
                  <th className='label-xs px-3 py-2'>Root hash</th>
                  <th className='label-xs px-3 py-2'>Action</th>
                  <th className='label-xs px-3 py-2'>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {identity && identity.rootHistory.map((r) => (
                  <tr key={r.version} className='border-b border-steel-900 last:border-b-0'>
                    <td className='px-3 py-1.5 font-mono text-steel-200'>v{r.version}</td>
                    <td className='px-3 py-1.5'><CopyText value={r.rootHash} /></td>
                    <td className='px-3 py-1.5 font-mono text-[11px] text-steel-400'>{r.action}</td>
                    <td className='px-3 py-1.5 font-mono text-[11px] text-steel-500'>{fmtTime(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
        <div className='col-span-2 space-y-3'>
          <Panel title='Identity operations'>
            <div className='space-y-2'>
              {ACTIONS.map((a) => (
                <Btn key={a.key} variant={a.key === 'deactivate' ? 'danger' : 'ghost'} className='w-full justify-center' onClick={() => run(a.key)} disabled={identity && identity.status === 'DEACTIVATED'}>
                  <a.icon size={13} /> {a.label}
                </Btn>
              ))}
            </div>
            <p className='mt-3 text-[11px] text-steel-500 leading-relaxed'>Each operation opens the step-up flow (passkey + wallet-signed permit) before submission. State changes are applied only after on-chain confirmation.</p>
            {op && <OpLine id={op.id} />}
          </Panel>
        </div>
      </div>
      <StepUpModal
        open={!!modal}
        action={modal ? ACTIONS.find((a) => a.key === modal).label : ''}
        onClose={() => setModal(null)}
        onComplete={() => { opAwaitSignature(opId); setModal(null) }}
      />
      {op && op.currentStep === 'AWAITING_SIGNATURE' && (
        <div className='fixed bottom-4 right-4 panel px-4 py-3 shadow-pop flex items-center gap-3 z-50'>
          <span className='font-mono text-[11px] text-steel-300'>Permit bound — submit transaction?</span>
          <Btn variant='primary' onClick={() => useStore.getState().opSubmit(op.id)}>Sign and submit</Btn>
        </div>
      )}
    </div>
  )
}