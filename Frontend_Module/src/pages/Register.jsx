import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet, ArrowLeft, ShieldCheck, Sparkles, Building2, Mail, Hash, KeyRound, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { hex } from '../mock/api'
import { Btn, Field, inputCls, CopyText } from '../components/ui'

const PRESET_WALLETS = [
  { label: 'Alice (Anvil #2)', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
  { label: 'Bob (Anvil #3)', address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' },
  { label: 'Deployer (Anvil #0)', address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
]

export default function Register() {
  const [name, setName] = useState('')
  const [customDid, setCustomDid] = useState('')
  const [didMode, setDidMode] = useState('auto') // 'auto' | 'custom'
  const [wallet, setWallet] = useState('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC')
  const [organization, setOrganization] = useState('')
  const [email, setEmail] = useState('')
  const [passkey, setPasskey] = useState('')
  const [confirmPasskey, setConfirmPasskey] = useState('')
  const [showPasskey, setShowPasskey] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const registerDid = useStore((s) => s.registerDid)
  const login = useStore((s) => s.login)
  const navigate = useNavigate()

  useEffect(() => {
    if (didMode === 'auto') {
      const clean = name.toLowerCase().replace(/[^a-z0-9.]/g, '.')
      setCustomDid(clean ? `did:sih:${clean}.main` : '')
    }
  }, [name, didMode])

  const effectiveDid = didMode === 'auto'
    ? (customDid || (name ? `did:sih:${name.toLowerCase().replace(/[^a-z0-9.]/g, '.')}.main` : ''))
    : customDid

  const create = async () => {
    if (!name.trim()) {
      setError('Operator / Identity name is required.')
      return
    }
    if (!wallet.trim()) {
      setError('Controller wallet address is required.')
      return
    }
    if (!passkey.trim()) {
      setError('Please set an operator passkey / password.')
      return
    }
    if (passkey.trim().length < 4) {
      setError('Passkey must be at least 4 characters long.')
      return
    }
    if (passkey.trim() !== confirmPasskey.trim()) {
      setError('Passkey and confirm passkey do not match.')
      return
    }

    setError('')
    setBusy(true)

    try {
      const id = await registerDid({
        name: name.trim(),
        did: effectiveDid.trim(),
        controllerAddress: wallet.trim(),
        organization: organization.trim(),
        email: email.trim(),
        passkey: passkey.trim(),
      })
      await login(id.did, passkey.trim())
      navigate('/dashboard')
    } catch (err) {
      setBusy(false)
      setError(err.message || 'Failed to register identity.')
    }
  }

  return (
    <div className='min-h-screen flex items-center justify-center p-6 bg-base-950'>
      <div className='w-[540px]'>
        <Link to='/login' className='font-mono text-[10px] text-steel-500 hover:text-steel-200 inline-flex items-center gap-1 mb-4 transition-colors'>
          <ArrowLeft size={11} /> back to sign-in
        </Link>
        <div className='panel p-0 overflow-hidden shadow-2xl border-steel-800'>
          <div className='px-6 py-5 border-b border-steel-800/80 bg-base-900/50'>
            <div className='flex items-center gap-2 mb-1'>
              <ShieldCheck size={16} className='text-accent' />
              <h1 className='text-[13px] font-semibold text-steel-100 tracking-wider uppercase'>Create DID Identity</h1>
            </div>
            <p className='text-[12px] text-steel-400'>Configure custom decentralized identifier parameters, controller credentials, and metadata.</p>
          </div>

          <div className='p-6 space-y-4'>
            {/* Identity Name */}
            <Field label='Operator / Identity Name *'>
              <input
                className={inputCls}
                placeholder='e.g. Anubhav Sharma or martel.custody'
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>

            {/* DID Configuration */}
            <div>
              <div className='flex items-center justify-between mb-1'>
                <span className='label-xs'>Decentralized Identifier (DID) *</span>
                <div className='flex items-center gap-2 font-mono text-[10px]'>
                  <button
                    type='button'
                    onClick={() => setDidMode('auto')}
                    className={`px-1.5 py-0.5 rounded transition-colors ${didMode === 'auto' ? 'bg-accent/20 text-accent font-semibold' : 'text-steel-500 hover:text-steel-300'}`}
                  >
                    Auto-format
                  </button>
                  <span className='text-steel-700'>|</span>
                  <button
                    type='button'
                    onClick={() => setDidMode('custom')}
                    className={`px-1.5 py-0.5 rounded transition-colors ${didMode === 'custom' ? 'bg-accent/20 text-accent font-semibold' : 'text-steel-500 hover:text-steel-300'}`}
                  >
                    Custom string
                  </button>
                </div>
              </div>
              <input
                className={`${inputCls} ${didMode === 'auto' ? 'text-accent' : ''}`}
                placeholder='e.g. did:sih:anubhav.sharma.main'
                value={customDid}
                onChange={(e) => {
                  setDidMode('custom')
                  setCustomDid(e.target.value)
                }}
              />
              <span className='block mt-1 font-mono text-[10px] text-steel-500'>
                Resolves on-chain as: <span className='text-steel-300'>{effectiveDid || 'did:sih:…'}</span>
              </span>
            </div>

            {/* Controller Wallet */}
            <div>
              <div className='flex items-center justify-between mb-1'>
                <span className='label-xs'>Controller Wallet Address *</span>
                <button
                  type='button'
                  onClick={() => setWallet('0x' + hex(40))}
                  className='text-[10px] font-mono text-steel-400 hover:text-accent flex items-center gap-1 transition-colors'
                >
                  <Sparkles size={10} /> Generate Random
                </button>
              </div>
              <input
                className={inputCls}
                placeholder='0x...'
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
              />
              <div className='mt-2 flex items-center gap-1.5 flex-wrap'>
                <span className='text-[10px] text-steel-500 font-mono'>Presets:</span>
                {PRESET_WALLETS.map((p) => (
                  <button
                    key={p.address}
                    type='button'
                    onClick={() => setWallet(p.address)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                      wallet.toLowerCase() === p.address.toLowerCase()
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-steel-800 hover:border-steel-700 text-steel-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Metadata (Organization / Email) */}
            <div className='grid grid-cols-2 gap-3 pt-1'>
              <Field label='Organization / Unit (Optional)'>
                <div className='relative'>
                  <Building2 size={12} className='absolute left-2.5 top-2.5 text-steel-600' />
                  <input
                    className={`${inputCls} pl-8`}
                    placeholder='e.g. Asset Operations'
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                  />
                </div>
              </Field>
              <Field label='Contact Email (Optional)'>
                <div className='relative'>
                  <Mail size={12} className='absolute left-2.5 top-2.5 text-steel-600' />
                  <input
                    className={`${inputCls} pl-8`}
                    type='email'
                    placeholder='e.g. operator@domain.org'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </Field>
            </div>

            {/* Passkey Setup */}
            <div className='border-t border-steel-800/80 pt-3 space-y-3'>
              <div className='flex items-center justify-between'>
                <span className='label-xs flex items-center gap-1.5 text-steel-200'>
                  <KeyRound size={12} className='text-accent' /> Operator Passkey / Password *
                </span>
                <span className='text-[10px] font-mono text-steel-500'>Required for sign-in & step-up</span>
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <div className='relative'>
                    <input
                      type={showPasskey ? 'text' : 'password'}
                      className={`${inputCls} pr-9`}
                      placeholder='New passkey (min 4 chars)'
                      value={passkey}
                      onChange={(e) => {
                        setPasskey(e.target.value)
                        setError('')
                      }}
                    />
                    <button
                      type='button'
                      onClick={() => setShowPasskey(!showPasskey)}
                      className='absolute right-2.5 top-2.5 text-steel-500 hover:text-steel-300 transition-colors'
                      title={showPasskey ? 'Hide passkey' : 'Show passkey'}
                    >
                      {showPasskey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
                <div>
                  <input
                    type={showPasskey ? 'text' : 'password'}
                    className={inputCls}
                    placeholder='Confirm passkey'
                    value={confirmPasskey}
                    onChange={(e) => {
                      setConfirmPasskey(e.target.value)
                      setError('')
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {error && (
              <div className='p-2.5 bg-bad/10 border border-bad/40 rounded text-[11px] font-mono text-bad flex items-start gap-2'>
                <AlertCircle size={14} className='shrink-0 mt-0.5' />
                <div className='leading-tight'>{error}</div>
              </div>
            )}

            <Btn
              variant='primary'
              className='w-full justify-center py-2.5 text-[13px]'
              disabled={!name.trim() || !effectiveDid.trim() || !wallet.trim() || !passkey.trim() || !confirmPasskey.trim() || busy}
              onClick={create}
            >
              {busy ? 'Registering identity & binding passkey…' : 'Register DID Identity →'}
            </Btn>

            <div className='inset-panel px-3.5 py-2.5 font-mono text-[10px] text-steel-500 leading-relaxed'>
              <div>&gt; Genesis Merkle Root v1 initialized for this DID</div>
              <div>&gt; Controller wallet verified against Chain 31337 IdentityRegistry</div>
              <div>&gt; Device passkey credentials stored in local secure enclave</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
