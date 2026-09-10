import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Fingerprint, ArrowRight, Eye, EyeOff, AlertCircle, KeyRound, UserCheck } from 'lucide-react'
import { useStore } from '../store'
import { inputCls } from '../components/ui'

export default function Login() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [didInput, setDidInput] = useState('')
  const [passkey, setPasskey] = useState('')
  const [showPasskey, setShowPasskey] = useState(false)
  const [error, setError] = useState('')

  const login = useStore((s) => s.login)
  const session = useStore((s) => s.session)
  const navigate = useNavigate()

  if (session) {
    navigate('/dashboard')
    return null
  }

  const go = async () => {
    const trimmedDid = didInput.trim()
    if (!trimmedDid) {
      setError('Please enter your DID identity or username.')
      return
    }
    if (!passkey.trim()) {
      setError('Operator passkey is required to authenticate.')
      return
    }

    setError('')
    setBusy(true)

    try {
      setStatus('requesting challenge for ' + (trimmedDid.slice(0, 18) + '…'))
      await new Promise((r) => setTimeout(r, 450))
      setStatus('verifying client passkey assertion…')
      await new Promise((r) => setTimeout(r, 550))
      setStatus('issuing session token & loading credentials…')
      await login(trimmedDid, passkey.trim())
      navigate('/dashboard')
    } catch (err) {
      setBusy(false)
      setStatus('')
      if (err.message === 'INCORRECT_PASSKEY') {
        setError('Authentication rejected: Incorrect passkey for this identity.')
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
            <p className='text-[12px] text-steel-400'>Enter your DID identity and operator passkey to authenticate.</p>
          </div>

          <div className='p-6 space-y-4'>
            {/* Identity Input */}
            <div>
              <label className='label-xs flex items-center gap-1.5 mb-1.5'>
                <UserCheck size={12} className='text-accent' /> DID Identity or Username *
              </label>
              <input
                type='text'
                className={`${inputCls} py-2 font-mono text-[12px] text-steel-200`}
                placeholder='e.g. did:sih:... or your registered username'
                value={didInput}
                onChange={(e) => {
                  setDidInput(e.target.value)
                  setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') go()
                }}
                autoFocus
              />
              <p className='text-[11px] text-steel-500 font-mono mt-1'>
                Enter your private Decentralized Identifier (DID) or registered username.
              </p>
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
              disabled={busy || !didInput.trim() || !passkey.trim()}
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
