import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useStore, useIdentity } from '../store'
import { OTHER_DIDS } from '../mock/fixtures'
import { Badge, Btn, Field, KeyRow, Panel, PageHead, selectCls, inputCls } from '../components/ui'
import StagedFlow from '../components/StagedFlow'

export default function TransferWizard() {
  const { assetId } = useParams()
  const navigate = useNavigate()
  const session = useStore((s) => s.session)
  const asset = useStore((s) => s.assets.find((a) => a.assetId === assetId))
  const senderId = useIdentity(asset ? asset.ownerDid : null)
  const [to, setTo] = useState('')
  const [started, setStarted] = useState(false)

  if (!asset) return <div><PageHead title='Transfer asset' /><p className='font-mono text-[12px] text-steel-600'>&gt; asset not found</p></div>
  const recipientId = useIdentity(to)
  const oldOwner = asset.ownerDid
  return (
    <div>
      <PageHead title='Transfer Asset' sub={asset.name} actions={<Link to={'/assets/' + asset.assetId} className='font-mono text-[10px] text-steel-500 hover:text-steel-200'>&larr; ASSET</Link>} />
      <div className='space-y-3 max-w-[860px]'>
        <Panel title='Recipient selection'>
          <Field label='Recipient DID'>
            <select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)} disabled={started}>
              <option value=''>— select recipient did —</option>
              {OTHER_DIDS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <p className='text-[11px] text-steel-500 mt-2'>Transfer is atomic: the asset leaves the sender Merkle root and is committed under the recipient root in the same block. Both root versions advance on confirmation.</p>
        </Panel>
        {to && (
          <Panel title='Expected root transitions (atomic)'>
            <table className='w-full text-[12px]'>
              <thead><tr className='border-b border-steel-800 text-left'><th className='label-xs px-3 py-1.5'>Party</th><th className='label-xs px-3 py-1.5'>Root before</th><th className='label-xs px-3 py-1.5'>Root after</th></tr></thead>
              <tbody>
                <tr className='border-b border-steel-900'><td className='px-3 py-1.5 font-mono text-[11px]'>(sender) {oldOwner}</td><td className='px-3 py-1.5 font-mono text-steel-200'>v{senderId ? senderId.rootVersion : '-'}</td><td className='px-3 py-1.5 font-mono text-ok'>v{(senderId ? senderId.rootVersion : 0) + 1}</td></tr>
                <tr><td className='px-3 py-1.5 font-mono text-[11px]'>(recipient) {to}</td><td className='px-3 py-1.5 font-mono text-steel-200'>v{recipientId ? recipientId.rootVersion : '-'}</td><td className='px-3 py-1.5 font-mono text-ok'>v{(recipientId ? recipientId.rootVersion : 0) + 1}</td></tr>
              </tbody>
            </table>
          </Panel>
        )}
        {to && !started && (
          <Btn variant='primary' onClick={() => setStarted(true)}>Initiate transfer operation</Btn>
        )}
        {started && to && (
          <StagedFlow
            type='transfer'
            label={'transfer to ' + to.split(':')[2]}
            relatedId={asset.assetId}
            payload={{ from: oldOwner, to }}
            onConfirmed={() => setTimeout(() => navigate('/assets/' + asset.assetId), 1500)}
          />
        )}
      </div>
    </div>
  )
}