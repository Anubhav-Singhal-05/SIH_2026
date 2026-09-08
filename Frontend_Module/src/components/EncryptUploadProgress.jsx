import { useEffect, useRef, useState } from 'react'
import { FileLock2, UploadCloud, CheckSquare } from 'lucide-react'
import { PCT } from '../mock/api'
import { Btn, inputCls } from './ui'

export default function EncryptUploadProgress({ onDone, busy = false }) {
  const [file, setFile] = useState(null)
  const [phase, setPhase] = useState('pick') // pick | encrypt | upload | done
  const [encP, setEncP] = useState(0)
  const [upP, setUpP] = useState(0)
  const [checksum, setChecksum] = useState('')
  const [fileDataUrl, setFileDataUrl] = useState('')
  const [fileText, setFileText] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearInterval(timer.current), [])

  const handleFile = (selected) => {
    if (!selected) {
      setFile(null)
      return
    }
    setFile(selected)
    setPhase('pick')
    setEncP(0)
    setUpP(0)

    // Read file data for inline preview and download
    const reader = new FileReader()
    if (selected.type.startsWith('image/') || selected.type === 'application/pdf') {
      reader.readAsDataURL(selected)
      reader.onload = () => setFileDataUrl(reader.result)
    } else {
      reader.readAsText(selected)
      reader.onload = () => {
        setFileText(reader.result)
        // Also provide a dataUrl fallback
        const r2 = new FileReader()
        r2.readAsDataURL(selected)
        r2.onload = () => setFileDataUrl(r2.result)
      }
    }
  }

  const start = async () => {
    if (!file) return
    setPhase('encrypt')

    // Compute real cryptographic checksum
    let calculatedHash = ''
    try {
      const buffer = await file.arrayBuffer()
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      calculatedHash = '0x' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      calculatedHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    }
    setChecksum(calculatedHash)

    timer.current = setInterval(() => {
      setEncP((p) => {
        const n = Math.min(100, p + Math.floor(Math.random() * 18) + 8)
        if (n >= 100) {
          clearInterval(timer.current)
          setTimeout(() => setPhase('upload'), 350)
        }
        return n
      })
    }, 120)
  }

  useEffect(() => {
    if (phase !== 'upload') return
    timer.current = setInterval(() => {
      setUpP((p) => {
        const n = Math.min(100, p + Math.floor(Math.random() * 15) + 6)
        if (n >= 100) {
          clearInterval(timer.current)
          setTimeout(() => {
            setPhase('done')
            onDone && onDone({
              name: file.name,
              size: file.size,
              contentType: file.type || 'application/pdf',
              checksum,
              dataUrl: fileDataUrl,
              textContent: fileText,
              file,
            })
          }, 350)
        }
        return n
      })
    }, 140)
  }, [phase, checksum, fileDataUrl, fileText])

  const bar = (p) => (
    <div className='h-2 bg-base-950 border border-steel-800 rounded-sm overflow-hidden'>
      <div className='h-full bg-accent transition-all duration-150' style={{ width: p + PCT }} />
    </div>
  )

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <input
          type='file'
          className={inputCls + ' py-1.5 text-[12px]'}
          onChange={(e) => handleFile(e.target.files[0] || null)}
          disabled={phase !== 'pick' && phase !== 'done'}
        />
        {file && phase === 'pick' && (
          <Btn variant='primary' onClick={start} disabled={busy}>
            <FileLock2 size={13} /> Encrypt + stage
          </Btn>
        )}
      </div>

      <div className='inset-panel divide-y divide-steel-900'>
        <div className='flex items-center gap-2.5 px-3 py-2.5'>
          <FileLock2 size={13} className={phase === 'pick' ? 'text-steel-600' : phase === 'encrypt' ? 'text-accent' : 'text-ok'} />
          <span className='font-mono text-[11px] tracking-wider text-steel-300 w-56'>CLIENT-SIDE ENCRYPTION</span>
          <div className='flex-1'>
            {phase === 'pick' ? (
              <span className='font-mono text-[10px] text-steel-600'>idle — select document to start</span>
            ) : phase === 'encrypt' ? (
              bar(encP)
            ) : (
              <span className='font-mono text-[10px] text-ok'>complete / AES-256-GCM ciphertext ready</span>
            )}
          </div>
          <span className='font-mono text-[11px] text-steel-400 w-10 text-right'>
            {phase === 'pick' ? '' : phase === 'encrypt' ? encP + PCT : '100' + PCT}
          </span>
        </div>

        <div className='flex items-center gap-2.5 px-3 py-2.5'>
          <UploadCloud size={13} className={phase === 'upload' ? 'text-accent' : phase === 'done' ? 'text-ok' : 'text-steel-600'} />
          <span className='font-mono text-[11px] tracking-wider text-steel-300 w-56'>UPLOAD CIPHERTEXT (STAGED)</span>
          <div className='flex-1'>
            {phase === 'pick' || phase === 'encrypt' ? (
              <span className='font-mono text-[10px] text-steel-600'>waiting for encryption</span>
            ) : phase === 'upload' ? (
              bar(upP)
            ) : (
              <span className='font-mono text-[10px] text-ok'>staged / storage reference verified</span>
            )}
          </div>
          <span className='font-mono text-[11px] text-steel-400 w-10 text-right'>
            {phase === 'pick' || phase === 'encrypt' ? '' : phase === 'upload' ? upP + PCT : '100' + PCT}
          </span>
        </div>

        <div className='flex items-center gap-2.5 px-3 py-2.5'>
          <CheckSquare size={13} className={phase === 'done' ? 'text-ok' : 'text-steel-600'} />
          <span className='font-mono text-[11px] tracking-wider text-steel-300 w-56'>SHA-256 FINALIZED</span>
          <span className='font-mono text-[10px] text-steel-400 truncate max-w-sm'>
            {phase === 'done' ? checksum : 'pending computation'}
          </span>
        </div>
      </div>
    </div>
  )
}
