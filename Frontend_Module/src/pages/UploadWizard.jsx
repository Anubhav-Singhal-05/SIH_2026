import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, uuid, now, hex64, assetId } from '../mock/api'
import { useStore } from '../store'
import { Badge, Btn, CopyText, KeyRow, Panel, PageHead, Stepper } from '../components/ui'
import EncryptUploadProgress from '../components/EncryptUploadProgress'
import StagedFlow from '../components/StagedFlow'
import { storeDocument } from '../utils/documentStorage'

// 8-step wizard: select+encrypt, stage, checksum, mint intent, step-up,
// signature, confirmation polling, success.
const STEPS = ['SELECT + ENCRYPT', 'STAGE + UPLOAD', 'CHECKSUM FINALIZE', 'MINT INTENT', 'STEP-UP', 'SIGNATURE', 'CONFIRMATION', 'REGISTERED']

export default function UploadWizard() {
  const navigate = useNavigate()
  const session = useStore((s) => s.session)
  const identity = useStore((s) => s.identities.find((i) => i.did === (s.session ? s.session.did : null)))
  const [staged, setStaged] = useState(null)
  const [intent, setIntent] = useState(null)
  const [step, setStep] = useState(0) // highest visible step index

  const markDone = (idx) => setStep((s) => Math.max(s, idx))

  const onUploadDone = async ({ name, size, contentType, checksum, dataUrl, textContent, file }) => {
    const stagedId = uuid()
    const stagedObj = {
      stagedId,
      name,
      size,
      contentType,
      checksum,
      dataUrl,
      textContent,
      file,
    }
    setStaged(stagedObj)
    markDone(2)

    if (file) {
      await storeDocument(stagedId, file, { name, contentType })
    }

    const it = await api.createMintIntent({
      callerDid: session.did,
      ownerDid: session.did,
      stagedId: stagedObj.stagedId,
      verified: false,
      rootVersion: identity ? identity.rootVersion : 1,
    })
    setIntent(it)

    if (file && it?.assetId) {
      await storeDocument(String(it.assetId), file, { name, contentType })
    }

    markDone(3)
  }
  const newAsset = intent && staged ? {
    assetId: String(intent.assetId),
    name: staged.name || 'document.pdf',
    contentType: staged.contentType || 'application/pdf',
    sizeBytes: staged.size || 0,
    ownerDid: session.did,
    documentVersion: 1,
    status: 'CONFIRMED',
    documentHash: staged.checksum || hex64(),
    createdAt: now(),
    updatedAt: now(),
    dataUrl: staged.dataUrl || null,
    textContent: staged.textContent || null,
    versions: [{ version: 1, hash: staged.checksum || hex64(), note: 'Initial registered version', at: now() }],
    integrity: 'VERIFIED',
  } : null

  return (
    <div>
      <PageHead title='Upload + Mint Asset' sub='client-encrypted staging / checksum / registry mint' actions={<span className='font-mono text-[10px] text-steel-600'>root base: v{identity.rootVersion}</span>} />
      <div className='flex items-center gap-1 mb-3 font-mono text-[9px] tracking-wider flex-wrap'>
        {STEPS.map((s, i) => (
          <span key={s} className='flex items-center gap-1'>
            {i > 0 && <span className='text-steel-800'>|</span>}
            <span className={i < step ? 'text-ok' : i === step ? 'text-accent-bright' : 'text-steel-600'}>{i + 1} {s}</span>
          </span>
        ))}
      </div>
      <div className='space-y-3 max-w-[860px]'>
        <Panel title='1-2 / Select file, encrypt and stage'>
          <EncryptUploadProgress onDone={onUploadDone} />
        </Panel>
        {intent && (
          <Panel title='4 / Mint intent created'>
            <KeyRow k='Reserved asset ID'><CopyText value={intent.assetId} /></KeyRow>
            <KeyRow k='Registry target'><span className='font-mono text-[12px]'>{intent.target}</span></KeyRow>
            <KeyRow k='Root reference'><span className='font-mono text-[12px]'>v{intent.rootVersion} — rejected if stale at submission</span></KeyRow>
            <KeyRow k='Permit calldata'><span className='font-mono text-[11px] text-steel-500'>{intent.calldata ? intent.calldata.slice(0, 42) + '…' : '0x (empty until verified)'}</span></KeyRow>
          </Panel>
        )}
        {intent && (
          <StagedFlow
            type='mint'
            label='mint asset'
            relatedId={intent.assetId}
            payload={newAsset}
            hint='step-up and signature outstanding'
            onConfirmed={() => {
              if (staged?.file && intent?.assetId) {
                storeDocument(String(intent.assetId), staged.file, { name: staged.name, contentType: staged.contentType })
              }
              markDone(7)
            }}
          />
        )}
        {step >= 7 && newAsset && (
          <Panel title='8 / Asset registered'>
            <div className='flex items-center gap-2 mb-2'><Badge status='CONFIRMED' /><span className='text-[12px] text-ok'>Mint confirmed. Root version advanced.</span></div>
            <KeyRow k='New asset ID'><CopyText value={newAsset.assetId} full /></KeyRow>
            <KeyRow k='Root version'><span className='font-mono'>v{(identity ? identity.rootVersion : 0) + 1}</span></KeyRow>
            <div className='mt-3'><Btn variant='primary' onClick={() => navigate('/assets/' + newAsset.assetId)}>Open asset detail</Btn></div>
          </Panel>
        )}
      </div>
    </div>
  )
}
