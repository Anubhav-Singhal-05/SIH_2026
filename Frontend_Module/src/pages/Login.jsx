import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Fingerprint, ArrowRight } from 'lucide-react'
import { useStore } from '../store'
import { SELF_DID } from '../mock/fixtures'
import { Btn } from '../components/ui'

export default function Login() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const login = useStore((s) => s.login)
  const session = useStore((s) => s.session)
  const navigate = useNavigate()
  if (session) { navigate('/dashboard'); return null }
  const go = async () => {
    setBusy(true)
    setStatus('creating webauthn challenge…')
    await new Promise((r) => setTimeout(r, 700))
    setStatus('waiting for authenticator assertion…')
    await new Promise((r) => setTimeout(r, 900))
    setStatus('assertion verified / issuing session tokens…')
    await login()
    navigate('/dashboard')
  }
  return (
    <div className='min-h-screen flex items-center justify-center p-6'>
      <div className='w-[420px]'>
        <div className='flex items-center gap-2.5 mb-6'>
          <div className='w-7 h-7 border border-accent rounded-sm flex items-center justify-center'><div className='w-2.5 h-2.5 bg-accent rounded-full' /></div>
          <div>
            <div className='text-[13px] font-semibold tracking-[0.2em] text-steel-100'>AEGIS REGISTRY</div>
            <div className='text-[9px] tracking-[0.24em] text-steel-500'>DID IDENTITY / ACCESS / ASSET PLATFORM</div>
          </div>
        </div>
        <div className='panel'>
          <div className='px-5 py-5'>
            <h1 className='text-[13px] font-semibold text-steel-100 tracking-wider uppercase mb-1'>Operator Sign-In</h1>
            <p className='text-[12px] text-steel-500 mb-5'>Passkey-only authentication. No passwords exist on this platform.</p>
            <button onClick={go} disabled={busy} className='w-full btn-base bg-accent border-accent text-base-950 hover:bg-accent-bright justify-center py-2.5 disabled:opacity-50'>
              <Fingerprint size={15} /> {busy ? status : 'Authenticate with passkey'} {!busy && <ArrowRight size={13} />}
            </button>
            <div className='mt-4 inset-panel px-3 py-2 font-mono text-[10px] text-steel-600 leading-relaxed'>
              <div>&gt; session: 15min access token, rotating refresh family</div>
              <div>&gt; sensitive writes additionally require a wallet-signed step-up permit</div>
            </div>
          </div>
          <footer className='border-t border-steel-800 px-5 py-2.5 flex justify-between items-center'>
            <span className='font-mono text-[10px] text-steel-600'>chain 31337 / localnet</span>
            <Link to='/register' className='font-mono text-[10px] text-accent hover:text-accent-bright transition-colors duration-150'>CREATE NEW DID →</Link>
          </footer>
        </div>
      </div>
    </div>
  )
}