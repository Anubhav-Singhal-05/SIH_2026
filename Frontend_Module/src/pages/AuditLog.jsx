import { useEffect, useMemo, useState, useRef } from 'react'
import { ChevronDown, ChevronRight, Calendar, X } from 'lucide-react'
import { useStore } from '../store'
import { fmtTime } from '../mock/api'
import { CopyText, EmptyState, PageHead, Panel, SkeletonRows, selectCls } from '../components/ui'

const ACTION_OPTIONS = [
  { value: 'ALL', label: 'ALL ACTIVITIES' },
  { value: 'mint_intent', label: 'REGISTRATION INITIATED' },
  { value: 'mint_confirmed', label: 'REGISTERED ON-CHAIN' },
  { value: 'document_update', label: 'DOCUMENT UPDATED' },
  { value: 'transfer', label: 'OWNERSHIP TRANSFERRED' },
  { value: 'grant_created', label: 'ACCESS GRANTED' },
  { value: 'grant_revoked', label: 'ACCESS REVOKED' },
  { value: 'inheritance_configured', label: 'INHERITANCE SAVED' },
  { value: 'asset_deactivated', label: 'DEACTIVATED' },
]

const ACTION_LABELS = {
  mint_intent: 'Document Registration Initiated',
  mint_confirmed: 'Document Registered On-Chain',
  document_update: 'Document Version Updated',
  transfer: 'Ownership Transferred',
  transfer_intent: 'Transfer Initiated',
  transfer_confirmed: 'Ownership Transferred',
  grant_created: 'Access Granted',
  grant_intent: 'Access Grant Initiated',
  grant_revoked: 'Access Revoked',
  controller_rotated: 'Security Key Updated',
  inheritance_configured: 'Inheritance Plan Saved',
  inheritance_config: 'Inheritance Plan Saved',
  inheritance_config_confirmed: 'Inheritance Plan Confirmed On-Chain',
  inheritance_activate: 'Inheritance Activated',
  deactivate_confirmed: 'Identity Deactivated On-Chain',
  rotate_confirmed: 'Security Key Rotated On-Chain',
  suspend_confirmed: 'Identity Suspended On-Chain',
  chain_reorg: 'Blockchain Reorganization',
  asset_deactivated: 'Document Deactivated',
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

function SegmentedDateInput({ label, value, onChange }) {
  const dayRef = useRef(null)
  const monthRef = useRef(null)
  const yearRef = useRef(null)
  const pickerRef = useRef(null)

  const handleDayChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '')
    if (!raw) {
      onChange({ ...value, day: '' })
      return
    }

    // If single digit 4-9 entered, pad to 04-09 and jump to month
    if (raw.length === 1 && parseInt(raw, 10) >= 4) {
      const formatted = '0' + raw
      onChange({ ...value, day: formatted })
      monthRef.current?.focus()
      monthRef.current?.select()
      return
    }

    // If 2 digits entered (01-31)
    if (raw.length >= 2) {
      let num = parseInt(raw.slice(-2), 10)
      if (num > 31) num = 31
      if (num < 1) num = 1
      const formatted = String(num).padStart(2, '0')
      onChange({ ...value, day: formatted })
      monthRef.current?.focus()
      monthRef.current?.select()
      return
    }

    onChange({ ...value, day: raw })
  }

  const handleDayKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault()
      monthRef.current?.focus()
      monthRef.current?.select()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      yearRef.current?.focus()
      yearRef.current?.select()
    }
  }

  const handleMonthChange = (e) => {
    const raw = e.target.value.trim()
    if (!raw) {
      onChange({ ...value, monthText: '', monthNum: null })
      return
    }

    const digits = raw.replace(/\D/g, '')
    if (digits) {
      const num = parseInt(digits, 10)
      // Single digit 2-9
      if (digits.length === 1 && num >= 2 && num <= 9) {
        const mText = MONTH_NAMES[num - 1]
        onChange({ ...value, monthText: mText, monthNum: num })
        yearRef.current?.focus()
        yearRef.current?.select()
        return
      }
      // 2 digits (01-12)
      if (digits.length >= 2) {
        let validNum = parseInt(digits.slice(-2), 10)
        if (validNum > 12) validNum = 12
        if (validNum < 1) validNum = 1
        const mText = MONTH_NAMES[validNum - 1]
        onChange({ ...value, monthText: mText, monthNum: validNum })
        yearRef.current?.focus()
        yearRef.current?.select()
        return
      }
      // Single digit 0 or 1
      if (digits === '0' || digits === '1') {
        onChange({ ...value, monthText: digits, monthNum: digits === '1' ? 1 : null })
        return
      }
    }

    // Direct month text match (e.g. 'sep', 'jan')
    const letters = raw.toLowerCase()
    const foundIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(letters))
    if (foundIdx !== -1) {
      const mText = MONTH_NAMES[foundIdx]
      onChange({ ...value, monthText: mText, monthNum: foundIdx + 1 })
      if (letters.length >= 2) {
        yearRef.current?.focus()
        yearRef.current?.select()
      }
      return
    }

    onChange({ ...value, monthText: raw, monthNum: null })
  }

  const handleMonthKeyDown = (e) => {
    if (e.key === 'Backspace' && !value.monthText) {
      e.preventDefault()
      dayRef.current?.focus()
      dayRef.current?.select()
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault()
      yearRef.current?.focus()
      yearRef.current?.select()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      dayRef.current?.focus()
      dayRef.current?.select()
    }
  }

  const handleYearChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    onChange({ ...value, year: raw })

    // Cyclic jump: yyyy -> dd
    if (raw.length === 4) {
      dayRef.current?.focus()
      dayRef.current?.select()
    }
  }

  const handleYearKeyDown = (e) => {
    if (e.key === 'Backspace' && !value.year) {
      e.preventDefault()
      monthRef.current?.focus()
      monthRef.current?.select()
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault()
      dayRef.current?.focus()
      dayRef.current?.select()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      monthRef.current?.focus()
      monthRef.current?.select()
    }
  }

  const handleOpenCalendar = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (pickerRef.current) {
      if (typeof pickerRef.current.showPicker === 'function') {
        try {
          pickerRef.current.showPicker()
        } catch {
          pickerRef.current.focus()
        }
      } else {
        pickerRef.current.focus()
      }
    }
  }

  const handleNativePickerChange = (e) => {
    const iso = e.target.value
    if (!iso) return
    const parts = iso.split('-')
    if (parts.length === 3) {
      const y = parts[0]
      const mNum = parseInt(parts[1], 10)
      const d = parts[2]
      onChange({
        day: d,
        monthText: MONTH_NAMES[mNum - 1] || parts[1],
        monthNum: mNum,
        year: y,
      })
    }
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange({ day: '', monthText: '', monthNum: null, year: '' })
    dayRef.current?.focus()
  }

  const hasValue = Boolean(value.day || value.monthText || value.year)

  return (
    <div className='flex items-center gap-1 px-3 py-1.5 rounded bg-base-900 border border-steel-800 focus-within:border-accent text-[12px] font-mono transition-colors shadow-sm relative'>
      <span className='text-[10px] uppercase font-bold text-accent tracking-wider mr-1 select-none'>{label}</span>

      {/* Day segment */}
      <input
        ref={dayRef}
        type='text'
        inputMode='numeric'
        placeholder='dd'
        value={value.day}
        onChange={handleDayChange}
        onKeyDown={handleDayKeyDown}
        className='w-6 text-center bg-transparent text-steel-100 placeholder-steel-600 focus:outline-none focus:text-accent font-mono text-[12px]'
        title='Day (dd)'
      />

      <span className='text-steel-600 select-none'>-</span>

      {/* Month segment */}
      <input
        ref={monthRef}
        type='text'
        placeholder='mm'
        value={value.monthText}
        onChange={handleMonthChange}
        onKeyDown={handleMonthKeyDown}
        className='w-9 text-center bg-transparent text-steel-100 placeholder-steel-600 focus:outline-none focus:text-accent font-mono text-[12px] font-medium'
        title='Month (type number or name)'
      />

      <span className='text-steel-600 select-none'>-</span>

      {/* Year segment */}
      <input
        ref={yearRef}
        type='text'
        inputMode='numeric'
        placeholder='yyyy'
        value={value.year}
        onChange={handleYearChange}
        onKeyDown={handleYearKeyDown}
        className='w-11 text-center bg-transparent text-steel-100 placeholder-steel-600 focus:outline-none focus:text-accent font-mono text-[12px]'
        title='Year (yyyy)'
      />

      {/* Actions inside field */}
      <div className='flex items-center gap-1.5 ml-1.5 pl-1.5 border-l border-steel-800'>
        {hasValue && (
          <button
            type='button'
            onClick={handleClear}
            className='text-steel-500 hover:text-bad p-0.5 transition-colors'
            title='Clear date'
          >
            <X size={11} />
          </button>
        )}
        <button
          type='button'
          onClick={handleOpenCalendar}
          className='text-steel-400 hover:text-accent p-0.5 transition-colors cursor-pointer'
          title='Pick from calendar'
        >
          <Calendar size={13} />
        </button>
        <input
          ref={pickerRef}
          type='date'
          tabIndex={-1}
          className='sr-only'
          onChange={handleNativePickerChange}
        />
      </div>
    </div>
  )
}

export default function AuditLog() {
  const session = useStore((s) => s.session)
  const assets = useStore((s) => s.assets)
  const grants = useStore((s) => s.grants)
  const audits = useStore((s) => s.audits)
  const [action, setAction] = useState('ALL')
  const [result, setResult] = useState('ALL')
  const [fromDate, setFromDate] = useState({ day: '', monthText: '', monthNum: null, year: '' })
  const [toDate, setToDate] = useState({ day: '', monthText: '', monthNum: null, year: '' })
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { const t = setTimeout(() => setLoading(false), 600); return () => clearTimeout(t) }, [])

  const ownedAssetIds = useMemo(() => new Set(assets.filter((a) => session?.did && a.ownerDid === session.did).map((a) => String(a.assetId))), [assets, session?.did])
  const sharedAssetIds = useMemo(() => new Set(grants.filter((g) => session?.did && g.granteeDid === session.did).map((g) => String(g.assetId))), [grants, session?.did])
  const allUserAssetIds = useMemo(() => new Set([...ownedAssetIds, ...sharedAssetIds]), [ownedAssetIds, sharedAssetIds])

  const userAudits = useMemo(() => {
    if (!session?.did) return []
    return audits.filter((a) => {
      if (a.actorDid && a.actorDid === session.did) return true
      if (a.target && (a.target === session.did || a.target.includes(session.did))) return true
      if (a.target && allUserAssetIds.has(String(a.target))) return true
      if (a.operationId && allUserAssetIds.has(String(a.operationId))) return true
      return false
    })
  }, [audits, session?.did, allUserAssetIds])

  const fromTimestamp = useMemo(() => {
    if (fromDate.year && fromDate.monthNum && fromDate.day) {
      const y = parseInt(fromDate.year, 10)
      const d = parseInt(fromDate.day, 10)
      const dateObj = new Date(y, fromDate.monthNum - 1, d, 0, 0, 0, 0)
      return isNaN(dateObj.getTime()) ? null : dateObj.getTime()
    }
    return null
  }, [fromDate])

  const toTimestamp = useMemo(() => {
    if (toDate.year && toDate.monthNum && toDate.day) {
      const y = parseInt(toDate.year, 10)
      const d = parseInt(toDate.day, 10)
      const dateObj = new Date(y, toDate.monthNum - 1, d, 23, 59, 59, 999)
      return isNaN(dateObj.getTime()) ? null : dateObj.getTime()
    }
    return null
  }, [toDate])

  const rows = useMemo(() => {
    return userAudits.filter((a) => {
      if (action !== 'ALL' && a.action !== action) return false
      if (result !== 'ALL' && a.result !== result) return false
      if (fromTimestamp !== null && a.at < fromTimestamp) return false
      if (toTimestamp !== null && a.at > toTimestamp) return false
      return true
    })
  }, [userAudits, action, result, fromTimestamp, toTimestamp])

  return (
    <div>
      <PageHead title='Activity & Audit Trail' sub='Tamper-proof activity log / every document and access change is recorded' />
      <div className='flex items-center gap-3 mb-3 flex-wrap'>
        <select className={selectCls + ' w-64'} value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select className={selectCls + ' w-36'} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value='ALL'>ALL RESULTS</option>
          <option value='success'>SUCCESS</option>
          <option value='failure'>FAILURE</option>
        </select>

        {/* Segmented Date Inputs */}
        <SegmentedDateInput
          label='FROM:'
          value={fromDate}
          onChange={setFromDate}
        />

        <SegmentedDateInput
          label='TO:'
          value={toDate}
          onChange={setToDate}
        />

        <span className='font-mono text-[10px] text-steel-600 ml-auto'>{rows.length} events</span>
      </div>
      <Panel pad={false}>
        {loading ? <SkeletonRows cols={5} rows={8} /> : rows.length === 0 ? <div className='p-3'><EmptyState lines={['No activity recorded for this identity yet', 'Actions performed by you will appear here as verified audit records']} /></div> : (
          <table className='w-full text-[12px]'>
            <thead>
              <tr className='border-b border-steel-800 text-left'>
                <th className='label-xs px-3 py-2 w-8'></th>
                <th className='label-xs px-3 py-2'>Timestamp</th>
                <th className='label-xs px-3 py-2'>Performed By</th>
                <th className='label-xs px-3 py-2'>Activity</th>
                <th className='label-xs px-3 py-2'>Target Document / Entity</th>
                <th className='label-xs px-3 py-2'>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <FragmentRow key={a.id} a={a} isMe={Boolean(session?.did && a.actorDid === session.did)} open={openId === a.id} toggle={() => setOpenId(openId === a.id ? null : a.id)} />
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

function FragmentRow({ a, isMe, open, toggle }) {
  const actionLabel = ACTION_LABELS[a.action] || a.action
  return (
    <>
      <tr onClick={toggle} className='border-b border-steel-900 cursor-pointer hover:bg-base-800 transition-colors duration-150'>
        <td className='px-3 py-2 text-steel-600'>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
        <td className='px-3 py-2 font-mono text-[11px] text-steel-500'>{fmtTime(a.at)}</td>
        <td className='px-3 py-2 font-mono text-[11px]'>
          {isMe ? <span className='text-accent font-semibold px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-[10px]'>You</span> : <CopyText value={a.actorDid || a.actorDidHash} />}
        </td>
        <td className='px-3 py-2 text-steel-200 font-medium text-[12px]'>{actionLabel}</td>
        <td className='px-3 py-2'><CopyText value={a.target} /></td>
        <td className='px-3 py-2 pr-3'><span className={a.result === 'success' ? 'font-mono text-[10px] text-ok' : 'font-mono text-[10px] text-bad'}>{a.result.toUpperCase()}</span></td>
      </tr>
      {open && (
        <tr className='border-b border-steel-900 bg-base-950'>
          <td className='px-3 py-3'></td>
          <td colSpan='5' className='py-3 pr-6 text-[11px] text-steel-400 space-y-1.5'>
            <div className='font-mono'>Activity Reference: <CopyText value={a.requestId} className='inline-flex' /></div>
            <div className='font-mono'>Operation Batch: {a.operationId ? <CopyText value={a.operationId} className='inline-flex' /> : <span>—</span>}</div>
            <div className='font-mono'>Identity (DID): {a.actorDid ? <CopyText value={a.actorDid} full className='inline-flex' /> : <span>Current Session User</span>}</div>
            <div className='font-mono'>Privacy Protection Checksum: <CopyText value={a.actorDidHash} full className='inline-flex' /></div>
            <div className='text-steel-600 text-[10px] pt-1'>&gt; Cryptographically verified event; permanently saved in the decentralized audit ledger.</div>
          </td>
        </tr>
      )}
    </>
  )
}