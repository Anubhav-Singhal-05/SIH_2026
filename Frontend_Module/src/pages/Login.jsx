import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Fingerprint, ArrowRight, Eye, EyeOff, AlertCircle, KeyRound } from 'lucide-react'
import { useStore } from '../store'
import { selectCls, inputCls, Badge } from '../components/ui'

export default function Login() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [passkey, setPasskey] = useState('')
  const [showPasskey, setShowPasskey] = useState(false)
  const [error, setError] = useState('')

  const identities = useStore((s) => s.identities)
  const login = useStore((s) => s.login)
  const session = useStore((s) => s.session)
  const navigate = useNavigate()

  const [selectedDid, setSelectedDid] = useState(identities[0]?.did || '')
  const [isManual, setIsManual] = useState(false)
  const [manualDid, setManualDid] = useState('')

  if (session) {
    navigate('/dashboard')
    return null
  }

  const effectiveDid = isManual ? manualDid.trim() : selectedDid
  const currentIdentity = identities.find((i) => i.did === effectiveDid)

  const go = async () => {
    if (!effectiveDid) {
      setError('Please select or specify a DID identity.')
      return
    }
    if (!passkey.trim()) {
      setError('Operator passkey is required to authenticate.')
      return
    }

    setError('')
    setBusy(true)

    try {
      setStatus('requesting challenge for ' + (effectiveDid.slice(0, 16) + '…'))
      await new Promise((r) => setTimeout(r, 450))
      setStatus('verifying client passkey assertion…')
      await new Promise((r) => setTimeout(r, 550))
      setStatus('issuing session token & loading read models…')
      await login(effectiveDid, passkey.trim())
      navigate('/dashboard')
    } catch (err) {
      setBusy(false)
      setStatus('')
      if (err.message === 'INCORRECT_PASSKEY') {
        setError('Authentication rejected: Incorrect passkey for this identity. (Default seed passkey: passkey123)')
      } else {
        setError(err.message || 'Authentication failed. Please verify your credentials.')
      }
    }
  }

  return (
    <div className='min-h-screen flex items-center justify-center p-6 bg-base-950'>
      <div className='w-[460px]'>
        <div className='flex items-center gap-2.5 mb-6'>
          <div className='w-7 h-7 border border-accent rounded-sm flex items-center justify-center shadow-glow'>
            <div className='w-2.5 h-2.5 bg-accent rounded-full' />
          </div>
          <div>
            <div className='text-[13px] font-semibold tracking-[0.2em] text-steel-100'>AEGIS REGISTRY</div>
            <div className='text-[9px] tracking-[0.24em] text-steel-500'>DID IDENTITY / ACCESS / ASSET PLATFORM</div>
          </div>
        </div>

        <div className='panel p-0 overflow-hidden shadow-2xl border-steel-800'>
          <div className='px-6 py-5 border-b border-steel-800/80 bg-base-900/50'>
            <h1 className='text-[13px] font-semibold text-steel-100 tracking-wider uppercase mb-1'>Operator Sign-In</h1>
            <p className='text-[12px] text-steel-400'>Select your DID identity and enter your operator passkey to authenticate.</p>
          </div>

          <div className='p-6 space-y-4'>
            {/* Identity Selector */}
            <div>
              <div className='flex items-center justify-between mb-1.5'>
                <span className='label-xs'>Select Identity to Sign In</span>
                <button
                  type='button'
                  onClick={() => {
                    setIsManual(!isManual)
                    setError('')
                  }}
                  className='text-[10px] font-mono text-accent hover:text-accent-bright transition-colors'
                >
                  {isManual ? '← Choose from registered list' : '+ Enter custom DID manually'}
                </button>
              </div>

              {!isManual ? (
                <div className='space-y-2'>
                  <select
                    className={`${selectCls} py-2 font-mono text-[12px] text-steel-200 bg-base-900`}
                    value={selectedDid}
                    onChange={(e) => {
                      setSelectedDid(e.target.value)
                      setError('')
                    }}
                  >
                    {identities.map((id) => (
                      <option key={id.did} value={id.did}>
                        {id.name ? `${id.name} (${id.did.slice(0, 22)}…)` : id.did}
                      </option>
                    ))}
                  </select>

                  {currentIdentity && (
                    <div className='inset-panel p-3 text-[11px] font-mono space-y-1 bg-base-900/60'>
                      <div className='flex justify-between items-center'>
                        <span className='text-steel-400'>Name:</span>
                        <span className='text-steel-200 font-semibold'>{currentIdentity.name || 'Default Operator'}</span>
                      </div>
                      <div className='flex justify-between items-center'>
                        <span className='text-steel-400'>Controller:</span>
                        <span className='text-steel-300'>{currentIdentity.controllerAddress ? `${currentIdentity.controllerAddress.slice(0, 10)}…${currentIdentity.controllerAddress.slice(-6)}` : '-'}</span>
                      </div>
                      <div className='flex justify-between items-center'>
                        <span className='text-steel-400'>Root Version:</span>
                        <span className='text-accent'>v{currentIdentity.rootVersion || 1}</span>
                      </div>
                      <div className='flex justify-between items-center pt-0.5'>
                        <span className='text-steel-400'>Status:</span>
                        <Badge status={currentIdentity.status || 'ACTIVE'} />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className='space-y-2'>
                  <input
                    className={`${inputCls} py-2 font-mono text-[12px] text-steel-200`}
                    placeholder='e.g. did:sih:my.custom.did'
                    value={manualDid}
                    onChange={(e) => {
                      setManualDid(e.target.value)
                      setError('')
                    }}
                    autoFocus
                  />
                  <p className='text-[11px] text-steel-500 font-mono'>
                    Paste any DID registered on-chain or in your local environment.
                  </p>
                </div>
              )}
            </div>

            {/* Passkey Input */}
            <div>
              <div className='flex items-center justify-between mb-1.5'>
                <span className='label-xs flex items-center gap-1.5'>
                  <KeyRound size={12} className='text-accent' /> Operator Passkey / Password *
                </span>
                <span className='text-[10px] font-mono text-steel-500'>
                  Seed default: <code className='text-accent bg-base-900 px-1 py-0.5 rounded'>passkey123</code>
                </span>
              </div>
              <div className='relative'>
                <input
                  type={showPasskey ? 'text' : 'password'}
                  className={`${inputCls} py-2 font-mono text-[12px] text-steel-200 pr-10`}
                  placeholder='Enter passkey to authenticate'
                  value={passkey}
                  onChange={(e) => {
                    setPasskey(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') go()
                  }}
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

            {/* Error banner */}
            {error && (
              <div className='p-2.5 bg-bad/10 border border-bad/40 rounded text-[11px] font-mono text-bad flex items-start gap-2'>
                <AlertCircle size={14} className='shrink-0 mt-0.5' />
                <div className='leading-tight'>{error}</div>
              </div>
            )}

            <button
              onClick={go}
              disabled={busy || !effectiveDid || !passkey.trim()}
              className='w-full btn-base bg-accent border-accent text-base-950 hover:bg-accent-bright font-semibold justify-center py-2.5 disabled:opacity-40 transition-all shadow-md hover:shadow-glow'
            >
              <Fingerprint size={16} />
              {busy ? status : 'Authenticate with passkey'}
              {!busy && <ArrowRight size={14} />}
            </button>

            <div className='inset-panel px-3 py-2 font-mono text-[10px] text-steel-500 leading-relaxed'>
              <div>&gt; session: 15min access token, rotating refresh family</div>
              <div>&gt; sensitive writes additionally require a wallet-signed step-up permit</div>
            </div>
          </div>

          <footer className='border-t border-steel-800 px-6 py-3 flex justify-between items-center bg-base-900/40'>
            <span className='font-mono text-[10px] text-steel-500'>chain 31337 / localnet</span>
            <Link
              to='/register'
              className='font-mono text-[11px] text-accent hover:text-accent-bright font-medium transition-colors duration-150'
            >
              CREATE NEW DID →
            </Link>
          </footer>
        </div>
      </div>
    </div>
  )
}
