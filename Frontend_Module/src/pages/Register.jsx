import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet, ArrowLeft } from 'lucide-react'
import { useStore } from '../store'
import { hex } from '../mock/api'
import { Btn, Field, inputCls, CopyText } from '../components/ui'

export default function Register() {
  const [name, setName] = useState('')
  const [wallet, setWallet] = useState(null)
  const [busy, setBusy] = useState(false)
  const registerDid = useStore((s) => s.registerDid)
  const login = useStore((s) => s.login)
  const navigate = useNavigate()

  const create = async () => {
    setBusy(true)
    const id = await registerDid({ name })
    await login(id.did)
    navigate('/dashboard')
  }
  return (
    <div className='min-h-screen flex items-center justify-center p-6'>
      <div className='w-[460px]'>
        <Link to='/login' className='font-mono text-[10px] text-steel-500 hover:text-steel-200 inline-flex items-center gap-1 mb-4'><ArrowLeft size={11} /> back to sign-in</Link>
        <div className='panel'>
          <div className='px-5 py-5 space-y-4'>
            <div>
              <h1 className='text-[13px] font-semibold text-steel-100 tracking-wider uppercase mb-1'>Create DID Identity</h1>
              <p className='text-[12px] text-steel-500'>Registers a new decentralized identifier and binds a controller wallet.</p>
            </div>
            <Field label='Identity name'>
              <input className={inputCls} placeholder='e.g. martel.custody' value={name} onChange={(e) => setName(e.target.value)} />
              <span className='block mt-1 font-mono text-[10px] text-steel-600'>resolves as: did:platform:{name.toLowerCase().replace(/[^a-z0-9.]/g, '.') || '…'}.main</span>
            </Field>
            <div>
              <span className='label-xs block mb-1'>Controller wallet</span>
              {wallet ? (
                <div className='inset-panel px-3 py-2 flex items-center justify-between'>
                  <CopyText value={wallet} />
                  <span className='font-mono text-[10px] text-ok'>CONNECTED</span>
                </div>
              ) : (
                <Btn onClick={() => setTimeout(() => setWallet('0x' + hex(40)), 800)} disabled={busy}><Wallet size={13} /> Connect wallet (mock)</Btn>
              )}
            </div>
            <Btn variant='primary' className='w-full justify-center' disabled={!name || !wallet || busy} onClick={create}>{busy ? 'registering identity on-chain…' : 'Create identity'}</Btn>
            <div className='inset-panel px-3 py-2 font-mono text-[10px] text-steel-600 leading-relaxed'>
              <div>&gt; genesis root v1 minted at registration</div>
              <div>&gt; encryption keypair generated client-side; only the fingerprint is registered</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}