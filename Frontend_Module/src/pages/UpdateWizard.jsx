import { useParams, useNavigate, Link } from 'react-router-dom'
import { hex64, now } from '../mock/api'
import { useStore } from '../store'
import { Badge, Btn, CopyText, KeyRow, Panel, PageHead } from '../components/ui'
import EncryptUploadProgress from '../components/EncryptUploadProgress'
import StagedFlow from '../components/StagedFlow'

export default function UpdateWizard() {
  const { assetId } = useParams()
  const navigate = useNavigate()
  const asset = useStore((s) => s.assets.find((a) => a.assetId === assetId))
  const [uploaded, setUploaded] = useState(null)

  if (!asset) return <div><PageHead title='Update document' /><p className='font-mono text-[12px] text-steel-600'>&gt; asset not found</p></div>
  const oldHash = asset.documentHash
  const newHash = uploaded ? uploaded.hash : null
  return (
    <div>
      <PageHead title='Update Document' sub={asset.name + ' / current v' + asset.documentVersion} actions={<Link to={'/assets/' + asset.assetId} className='font-mono text-[10px] text-steel-500 hover:text-steel-200'>&larr; ASSET</Link>} />
      <div className='space-y-3 max-w-[860px]'>
        <Panel title='1-3 / New version: encrypt, stage, checksum'>
          <EncryptUploadProgress onDone={(u) => setUploaded({ ...u, hash: hex64() })} />
        </Panel>
        {uploaded && (
          <Panel title='Root reference / hash delta'>
            <KeyRow k={'Old document hash (v' + asset.documentVersion + ')'}><CopyText value={oldHash} /></KeyRow>
            <KeyRow k={'New document hash (v' + (asset.documentVersion + 1) + ')'}><CopyText value={newHash} /></KeyRow>
            <KeyRow k='Version increment'><span className='font-mono'>v{asset.documentVersion} → v{asset.documentVersion + 1}</span></KeyRow>
            <KeyRow k='Current root'><span className='font-mono'>v{useStore.getState().identities.find((i) => i.did === asset.ownerDid).rootVersion} — stale references will be rejected</span></KeyRow>
          </Panel>
        )}
        {uploaded && (
          <StagedFlow
            type='update'
            label={'update document v' + (asset.documentVersion + 1)}
            relatedId={asset.assetId}
            payload={{ hash: newHash, note: 'revision ' + (asset.documentVersion + 1) }}
            onConfirmed={() => setTimeout(() => navigate('/assets/' + asset.assetId), 1200)}
          />
        )}
      </div>
    </div>
  )
}