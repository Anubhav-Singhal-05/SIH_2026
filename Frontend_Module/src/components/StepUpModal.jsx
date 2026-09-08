import { useEffect, useMemo, useState } from 'react'
import { Fingerprint, PenLine, ShieldCheck, X, Eye, EyeOff, KeyRound, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { hex, sleep, ERROR_COPY } from '../mock/api'
import { Badge, Btn, CopyText, inputCls } from './ui'

// Reusable step-up verification flow: passkey verify, wallet sign with fake
// calldata preview, confirmation wait, result. Used by every sensitive action.
export default function StepUpModal({ open, action, onClose, onComplete }) {
  const [phase, setPhase] = useState('passkey')
  const [failCode, setFailCode] = useState(null)
  const [passkeyInput, setPasskeyInput] = useState('')
  const [showPasskey, setShowPasskey] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')
  const [verifying, setVerifying] = useState(false)

  const session = useStore((s) => s.session)
  const verifyPasskey = useStore((s) => s.verifyPasskey)
  const injectNext = useStore((s) => s.injectNext)
  const setInjectNext = useStore((s) => s.setInjectNext)
  const calldata = useMemo(() => '0x' + hex(180), [open])
  const txHash = useMemo(() => '0x' + hex(64), [open])
  const permitHash = useMemo(() => '0x' + hex(64), [open])

  useEffect(() => {
    if (open) {
      setPhase('passkey')
      setFailCode(null)
      setPasskeyInput('')
      setPasskeyError('')
      setVerifying(false)
    }
  }, [open])

  if (!open) return null

  const handleVerifyPasskey = async () => {
    if (!passkeyInput.trim()) {
      setPasskeyError('Please enter your operator passkey.')
      return
    }
    setVerifying(true)
    setPasskeyError('')
    await sleep(500)
    const valid = verifyPasskey(session?.did, passkeyInput.trim())
    setVerifying(false)
    if (!valid) {
      setPasskeyError('Authorization denied: Incorrect operator passkey.')
      return
    }
    setPhase('sign')
  }

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
            <div className='space-y-3.5'>
              <div className='inset-panel p-3 text-[11px] font-mono space-y-1 bg-base-950'>
                <div className='flex justify-between items-center'>
                  <span className='text-steel-400'>Operator:</span>
                  <span className='text-steel-200 font-semibold'>{session?.name || 'Authorized Operator'}</span>
                </div>
                <div className='flex justify-between items-center'>
                  <span className='text-steel-400'>DID:</span>
                  <span className='text-steel-300'>{session?.did ? `${session.did.slice(0, 20)}…${session.did.slice(-8)}` : '-'}</span>
                </div>
              </div>

              <p className='text-[12px] text-steel-400 leading-relaxed'>
                A single-use cryptographic permit is required for this on-chain write. Enter your operator passkey to authorize this transaction.
              </p>

              <div>
                <div className='flex items-center justify-between mb-1'>
                  <span className='label-xs flex items-center gap-1.5'>
                    <KeyRound size={12} className='text-accent' /> Operator Passkey *
                  </span>
                  <span className='text-[10px] font-mono text-steel-500'>
                    Seed default: <code className='text-accent'>passkey123</code>
                  </span>
                </div>
                <div className='relative'>
                  <input
                    type={showPasskey ? 'text' : 'password'}
                    className={`${inputCls} py-2 font-mono text-[12px] text-steel-200 pr-10`}
                    placeholder='Enter operator passkey'
                    value={passkeyInput}
                    onChange={(e) => {
                      setPasskeyInput(e.target.value)
                      setPasskeyError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleVerifyPasskey()
                    }}
                    autoFocus
                  />
                  <button
                    type='button'
                    onClick={() => setShowPasskey(!showPasskey)}
                    className='absolute right-2.5 top-2.5 text-steel-500 hover:text-steel-300 transition-colors'
                    title={showPasskey ? 'Hide passkey' : 'Show passkey'}
                  >
                    {showPasskey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {passkeyError && (
                <div className='p-2.5 bg-bad/10 border border-bad/40 rounded text-[11px] font-mono text-bad flex items-start gap-2'>
                  <AlertCircle size={14} className='shrink-0 mt-0.5' />
                  <div className='leading-tight'>{passkeyError}</div>
                </div>
              )}

              <Btn
                variant='primary'
                className='w-full justify-center py-2'
                disabled={verifying || !passkeyInput.trim()}
                onClick={handleVerifyPasskey}
              >
                <Fingerprint size={14} />
                {verifying ? 'Verifying passkey assertion…' : 'Verify Passkey & Authorize'}
              </Btn>
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