import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Link2 } from 'lucide-react'
import { useStore, useOp } from '../store'
import { OTHER_DIDS } from '../mock/fixtures'
import { Badge, Btn, Field, KeyRow, PageHead, Panel, selectCls, inputCls, CopyText, Stepper } from '../components/ui'
import StepUpModal from '../components/StepUpModal'

function OpLine({ id }) { const op = useOp(id); return op ? <div className='mt-2'><Stepper op={op} compact /></div> : null }

export default function InheritanceSetup() {
  const session = useStore((s) => s.session)
  const inheritance = useStore((s) => s.inheritance)
  const inheritancesByDid = useStore((s) => s.inheritancesByDid)
  const assets = useStore((s) => s.assets)
  const patchInheritance = useStore((s) => s.patchInheritance)
  const startOperation = useStore((s) => s.startOperation)
  const opAwaitStepUp = useStore((s) => s.opAwaitStepUp)
  const opAwaitSignature = useStore((s) => s.opAwaitSignature)

  const effectiveRule = (session?.did && inheritancesByDid?.[session.did]) || (session?.did && inheritance?.ownerDid === session.did ? inheritance : {
    ownerDid: session?.did || 'did:sih:unknown',
    defaultNomineeDid: '',
    perAssetOverrides: [],
    authoritySet: [
      { label: 'AUTH-1', did: 'did:platform:meridian.trust', signed: false },
      { label: 'AUTH-2', did: 'did:platform:northgate.custody', signed: false },
      { label: 'AUTH-3', did: 'did:platform:quill.arch', signed: false },
    ],
    signaturesRequired: 2,
    status: 'NOT_CONFIGURED',
    activatedAt: null,
    batchProgress: [],
  })

  const [nominee, setNominee] = useState(effectiveRule.defaultNomineeDid || '')
  const [overrides, setOverrides] = useState(effectiveRule.perAssetOverrides || [])
  const [newAsset, setNewAsset] = useState('')
  const [newBenef, setNewBenef] = useState('')
  const [opId, setOpId] = useState(null)
  const [modal, setModal] = useState(false)
  const op = useOp(opId)

  const ownedAssets = assets.filter((a) => session?.did && a.ownerDid === session.did)

  const save = () => {
    const payload = { defaultNomineeDid: nominee, perAssetOverrides: overrides, status: 'CONFIGURED' }
    const id = startOperation({ type: 'inheritance_config', label: 'save inheritance rule', relatedId: session.did, payload })
    setOpId(id)
    setTimeout(() => opAwaitStepUp(id), 650)
    setModal(true)
  }
  const dirty = nominee !== effectiveRule.defaultNomineeDid || JSON.stringify(overrides) !== JSON.stringify(effectiveRule.perAssetOverrides)
  return (
    <div>
      <PageHead
        title='Inheritance Setup'
        sub='Set your default beneficiary or assign specific assets to different beneficiaries'
        actions={<Link to='/inheritance/activation' className='font-mono text-[10px] text-accent hover:text-accent-bright border border-steel-700 rounded px-2 py-1'>ACTIVATION + STATUS →</Link>}
      />
      <div className='grid grid-cols-5 gap-3 max-w-[1200px]'>
        <div className='col-span-3 space-y-3'>
          <Panel title='Default Nominee / Beneficiary'>
            <Field label='Nominee Name or ID (Receives assets when no specific override is set)'>
              <input
                className={`${inputCls} font-mono text-[12px]`}
                placeholder='Enter nominee name or user identifier (e.g. Anubha or did:sih:...)'
                value={nominee}
                onChange={(e) => setNominee(e.target.value)}
                disabled={effectiveRule.status === 'ACTIVE'}
              />
            </Field>
            <p className='text-[11px] text-steel-500 mt-2 leading-relaxed'>
              Security Guarantee: The nominee cannot claim your assets alone. Activation requires independent verification and consensus from at least 2 out of 3 authorized trustees.
            </p>
          </Panel>
          <Panel title='Per-Asset Beneficiary Overrides' pad={false}>
            <table className='w-full text-[12px]'>
              <thead><tr className='border-b border-steel-800 text-left'><th className='label-xs px-3 py-2'>Asset</th><th className='label-xs px-3 py-2'>Beneficiary Name / ID</th><th className='label-xs px-3 py-2'></th></tr></thead>
              <tbody>
                {overrides.length === 0 && <tr><td colSpan='3' className='px-3 py-3 font-mono text-[11px] text-steel-600'>&gt; No specific overrides set. The default nominee above will inherit all your assets.</td></tr>}
                {overrides.map((o, i) => (
                  <tr key={o.assetId} className='border-b border-steel-900 last:border-b-0'>
                    <td className='px-3 py-2 text-steel-300'>{(assets.find((a) => a.assetId === o.assetId) || {}).name || o.assetId.slice(0, 12) + '…'}</td>
                    <td className='px-3 py-2'><CopyText value={o.beneficiaryDid} /></td>
                    <td className='px-3 py-2 text-right pr-3'><button className='text-steel-600 hover:text-bad' onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}><Trash2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className='flex items-end gap-2 p-3 border-t border-steel-800'>
              <Field label='Asset'>
                <select className={selectCls + ' w-56'} value={newAsset} onChange={(e) => setNewAsset(e.target.value)} disabled={ownedAssets.length === 0}>
                  <option value=''>{ownedAssets.length === 0 ? '— no owned assets —' : '— select asset —'}</option>
                  {ownedAssets.map((a) => <option key={a.assetId} value={a.assetId}>{a.name}</option>)}
                </select>
              </Field>
              <Field label='Beneficiary Name or ID'>
                <input
                  className={`${inputCls} font-mono text-[12px] w-64`}
                  placeholder='Enter beneficiary name or ID'
                  value={newBenef}
                  onChange={(e) => setNewBenef(e.target.value)}
                />
              </Field>
              <Btn disabled={!newAsset || !newBenef.trim()} onClick={() => { if (newAsset && newBenef.trim()) { setOverrides([...overrides.filter((o) => o.assetId !== newAsset), { assetId: newAsset, beneficiaryDid: newBenef.trim() }]); setNewAsset(''); setNewBenef('') } }}><Plus size={12} /> Add</Btn>
            </div>
          </Panel>
        </div>
        <div className='col-span-2 space-y-3'>
          <Panel title='Rule state'>
            <KeyRow k='Status'><Badge status={effectiveRule.status} /></KeyRow>
            <KeyRow k='Authorities'><span className='font-mono text-[12px]'>2-of-3 signatures required</span></KeyRow>
            <KeyRow k='Activations'><span className='font-mono text-[12px]'>{effectiveRule.activatedAt ? new Date(effectiveRule.activatedAt).toISOString().slice(0, 19) : 'not activated'}</span></KeyRow>
          </Panel>
          <Panel title='Save configuration'>
            <Btn variant='primary' className='w-full justify-center' disabled={!dirty || effectiveRule.status === 'ACTIVE'} onClick={save}>Save via step-up</Btn>
            {op && <OpLine id={op.id} />}
          </Panel>
        </div>
      </div>
      <StepUpModal open={modal} action='Save inheritance rule' onClose={() => setModal(false)} onComplete={() => { opAwaitSignature(opId); setModal(false) }} />
      {op && op.currentStep === 'AWAITING_SIGNATURE' && (
        <div className='fixed bottom-4 right-4 panel px-4 py-3 shadow-pop flex items-center gap-3 z-50'>
          <span className='font-mono text-[11px] text-steel-300'>Permit bound — submit transaction?</span>
          <Btn variant='primary' onClick={() => useStore.getState().opSubmit(op.id)}>Sign and submit</Btn>
        </div>
      )}
    </div>
  )
}