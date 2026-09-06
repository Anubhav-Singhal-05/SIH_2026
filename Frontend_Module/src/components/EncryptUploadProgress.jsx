import { useEffect, useRef, useState } from 'react'
import { FileLock2, UploadCloud, CheckSquare } from 'lucide-react'
import { PCT } from '../mock/api'
import { Btn, inputCls } from './ui'

// Shared file pick -> client-side encryption -> ciphertext upload progress.
// Percentages advance in staged timer increments; never an instant jump.
export default function EncryptUploadProgress({ onDone, busy = false }) {
  const [file, setFile] = useState(null)
  const [phase, setPhase] = useState('pick') // pick | encrypt | upload | done
  const [encP, setEncP] = useState(0)
  const [upP, setUpP] = useState(0)
  const [checksum, setChecksum] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearInterval(timer.current), [])

  const start = () => {
    setPhase('encrypt')
    timer.current = setInterval(() => {
      setEncP((p) => {
        const n = Math.min(100, p + Math.floor(Math.random() * 13) + 4)
        if (n >= 100) {
          clearInterval(timer.current)
          setChecksum('sha256:' + Math.random().toString(16).slice(2, 10) + '…')
          setTimeout(() => setPhase('upload'), 450)
        }
        return n
      })
    }, 190)
  }

  useEffect(() => {
    if (phase !== 'upload') return
    timer.current = setInterval(() => {
      setUpP((p) => {
        const n = Math.min(100, p + Math.floor(Math.random() * 10) + 3)
        if (n >= 100) {
          clearInterval(timer.current)
          setTimeout(() => { setPhase('done'); onDone && onDone({ name: file.name, size: file.size, checksum }) }, 400)
        }
        return n
      })
    }, 220)
  }, [phase])

  const bar = (p) => (
    <div className='h-2 bg-base-950 border border-steel-800 rounded-sm overflow-hidden'>
      <div className='h-full bg-accent transition-all duration-150' style={{ width: p + PCT }} />
    </div>
  )

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <input type='file' className={inputCls + ' py-1 text-[12px]'} onChange={(e) => { setFile(e.target.files[0] || null); setPhase('pick'); setEncP(0); setUpP(0) }} disabled={phase !== 'pick' && phase !== 'done'} />
        {file && phase === 'pick' && <Btn variant='primary' onClick={start} disabled={busy}><FileLock2 size={13} /> Encrypt + stage</Btn>}
      </div>
      <div className='inset-panel divide-y divide-steel-900'>
        <div className='flex items-center gap-2.5 px-3 py-2.5'>
          <FileLock2 size={13} className={phase === 'pick' ? 'text-steel-600' : phase === 'encrypt' ? 'text-accent' : 'text-ok'} />
          <span className='font-mono text-[11px] tracking-wider text-steel-300 w-56'>CLIENT-SIDE ENCRYPTION</span>
          <div className='flex-1'>{phase === 'pick' ? <span className='font-mono text-[10px] text-steel-600'>idle</span> : phase === 'encrypt' ? bar(encP) : <span className='font-mono text-[10px] text-ok'>complete / AES-256-GCM key held client-side</span>}</div>
          <span className='font-mono text-[11px] text-steel-400 w-10 text-right'>{phase === 'pick' ? '' : phase === 'encrypt' ? encP + PCT : '100' + PCT}</span>
        </div>
        <div className='flex items-center gap-2.5 px-3 py-2.5'>
          <UploadCloud size={13} className={phase === 'upload' ? 'text-accent' : phase === 'done' ? 'text-ok' : 'text-steel-600'} />
          <span className='font-mono text-[11px] tracking-wider text-steel-300 w-56'>UPLOAD CIPHERTEXT (STAGED)</span>
          <div className='flex-1'>{phase === 'pick' || phase === 'encrypt' ? <span className='font-mono text-[10px] text-steel-600'>waiting for encryption</span> : phase === 'upload' ? bar(upP) : <span className='font-mono text-[10px] text-ok'>staged / one-time scoped destination</span>}</div>
          <span className='font-mono text-[11px] text-steel-400 w-10 text-right'>{phase === 'pick' || phase === 'encrypt' ? '' : phase === 'upload' ? upP + PCT : '100' + PCT}</span>
        </div>
        <div className='flex items-center gap-2.5 px-3 py-2.5'>
          <CheckSquare size={13} className={phase === 'done' ? 'text-ok' : 'text-steel-600'} />
          <span className='font-mono text-[11px] tracking-wider text-steel-300 w-56'>CHECKSUM FINALIZE</span>
          <span className='font-mono text-[10px] text-steel-500'>{phase === 'done' ? (checksum || '') : 'pending'}</span>
        </div>
      </div>
    </div>
  )
}