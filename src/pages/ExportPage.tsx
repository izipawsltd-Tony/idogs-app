import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useRequestGuard } from '../hooks/useRequestGuard'
import { getDogs, getLitters } from '../lib/db'
import type { Dog, Litter, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type Scope = 'dog' | 'litter' | 'kennel' | 'breeding'
type Format = 'pdf' | 'csv' | 'xlsx'
type Facility = { facilityName: string; address: string; council: string; approvalNumber: string; approvalDocumentRef: string; conditionNotes: string; ledgerStartDate: string; ledgerAttested: boolean; breedingFemale: string; breedingMale: string; boarding: string }
type Movement = { id: string; dogId: string; occurredAt: string; direction: string; category: string; note?: string; voidedAt?: unknown }
type DailyLog = { id: string; date: string; caretaker: string; exerciseMinutes: number | null; careNotes: string; incidentNotes: string }
const emptyFacility: Facility = { facilityName: '', address: '', council: '', approvalNumber: '', approvalDocumentRef: '', conditionNotes: '', ledgerStartDate: '', ledgerAttested: false, breedingFemale: '', breedingMale: '', boarding: '' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit' })

export default function ExportPage({ toast }: Props) {
  const { user, profile } = useAuth()
  const [dogs, setDogs] = useState<Dog[]>([])
  const [litters, setLitters] = useState<Litter[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('kennel')
  const [selectedDogId, setSelectedDogId] = useState('')
  const [selectedLitterId, setSelectedLitterId] = useState('')
  const [exporting, setExporting] = useState<Format | null>(null)
  // Codex round 14: distinct from `dogs`/`litters` being genuinely empty
  // — a failed load must BLOCK export entirely, not let the user
  // generate a report against a kennel summary that (silently) reads
  // "0 dogs and 0 litters" or an empty dog/litter selector dropdown.
  // Even though the /api/export-report endpoint re-derives its own data
  // server-side (so a "Full Kennel" export could technically still
  // succeed despite a client-side load failure), blocking unconditionally
  // is the safe, consistent choice: the user should never be looking at
  // a page that's actively lying about what it's about to export.
  const [loadError, setLoadError] = useState(false)
  const [facility, setFacility] = useState<Facility>(emptyFacility)
  const [movements, setMovements] = useState<Movement[]>([])
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([])
  const [period, setPeriod] = useState({ from: today(), to: today() })
  const [movement, setMovement] = useState({ dogId: '', direction: 'arrival', category: 'breeding', occurredAt: '', note: '' })
  const [dailyLog, setDailyLog] = useState({ date: today(), caretaker: '', exerciseMinutes: '', careNotes: '', incidentNotes: '' })
  const [saving, setSaving] = useState(false)
  const userState = (profile as any)?.state || 'SA'

  // Female dogs only for breeding compliance
  const femaleDogs = dogs.filter(d => d.sex === 'female' && (d as any).status !== 'transferred')
  const possibleTestDogs = dogs.filter(d => /(?:^|[\s_-])(?:qa|test)(?:$|[\s_-])/i.test(d.name || ''))

  const { beginRequest } = useRequestGuard(user?.uid)

  function loadExportData() {
    if (!user) return
    const req = beginRequest()
    setLoading(true)
    setLoadError(false)
    Promise.all([getDogs(), getLitters(), user.getIdToken().then(token => fetch('/api/kennel-report-data', { headers: { Authorization: `Bearer ${token}` } }).then(async response => {
      if (response.status === 403) return { facility: null, movements: [], dailyLogs: [] }
      if (!response.ok) throw new Error('Kennel report data unavailable')
      return response.json()
    }))])
      .then(([d, l, reportData]) => {
        if (!req.isCurrent()) return
        setDogs(d); setLitters(l)
        setFacility({ ...emptyFacility, ...(reportData.facility || {}), breedingFemale: String(reportData.facility?.breedingFemale ?? ''), breedingMale: String(reportData.facility?.breedingMale ?? ''), boarding: String(reportData.facility?.boarding ?? '') })
        setMovements(reportData.movements || []); setDailyLogs(reportData.dailyLogs || [])
      })
      .catch(() => {
        if (!req.isCurrent()) return
        setLoadError(true)
        toast('Failed to load data', 'error')
      })
      .finally(() => {
        if (!req.isCurrent()) return
        setLoading(false)
      })
  }

  useEffect(() => {
    // Clear the previous account's dogs/litters immediately on an account
    // switch — a stale selector option or kennel-summary count from a
    // former account must never linger into the new one's view.
    setDogs([]); setLitters([]); setLoadError(false)
    setFacility(emptyFacility); setMovements([]); setDailyLogs([])
    setSelectedDogId(''); setSelectedLitterId('')
    loadExportData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  async function saveKennelData(action: string, payload: Record<string, unknown>) {
    if (!user) return
    setSaving(true)
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/kennel-report-data', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...payload }) })
      if (!response.ok) throw new Error((await response.json()).error || 'Save failed')
      toast('Kennel record saved', 'success')
      loadExportData()
    } catch (error) { toast(error instanceof Error ? error.message : 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleExport(format: Format) {
    if (!user) return
    if (loadError) { toast('Your dogs/litters failed to load — retry before exporting', 'error'); return }
    if (scope === 'dog' && !selectedDogId) { toast('Please select a dog', 'error'); return }
    if (scope === 'litter' && !selectedLitterId) { toast('Please select a litter', 'error'); return }
    if (scope === 'breeding' && !selectedDogId) { toast('Please select a female dog', 'error'); return }

    // Open during the click gesture; browsers may block windows opened after
    // the token/API awaits. Keep it empty until the response succeeds.
    const previewWindow = format === 'pdf' ? window.open('', '_blank') : null
    if (format === 'pdf' && !previewWindow) { toast('Allow pop-ups for iDogs to open the PDF report', 'error'); return }
    if (previewWindow) previewWindow.document.body.textContent = 'Preparing report…'
    setExporting(format)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/export-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          scope,
          id: scope === 'dog' ? selectedDogId : scope === 'litter' ? selectedLitterId : scope === 'breeding' ? selectedDogId : null,
          tenantId: user.uid,
          format,
          userState,
          period: scope === 'kennel' ? period : undefined,
        }),
      })

      if (!res.ok) {
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}))
          if (body.reason === 'EXPORT_PLAN_GATE') {
            previewWindow?.close()
            toast('Report export is an iDogs Plus feature. Upgrade to Plus to export reports.', 'error')
            return
          }
        }
        throw new Error('Export failed')
      }

      if (format === 'csv' || format === 'xlsx') {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const contentDisp = res.headers.get('Content-Disposition') || ''
        const match = contentDisp.match(/filename="(.+)"/)
        a.download = match ? match[1] : `export.${format}`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        toast(`${format.toUpperCase()} downloaded ✓`, 'success')
      } else {
        const blob = await res.blob()
        if (blob.type !== 'application/pdf' || (await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('Invalid PDF response')
        const url = URL.createObjectURL(blob)
        if (previewWindow) previewWindow.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
        toast('PDF opened — use the viewer toolbar to download or print ✓', 'success')
      }
    } catch {
      previewWindow?.close()
      toast('Export failed. Please try again.', 'error')
    } finally {
      setExporting(null)
    }
  }

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
        Export & Compliance Reports
      </h1>
      <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 32 }}>
        Export your recorded dogs, litters and health history for review.
      </p>

      {loadError && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: '#FDEDED', border: '1px solid #F3B0B0', borderRadius: 'var(--radius-md)',
          padding: '10px 16px', marginBottom: 24,
        }}>
          <span style={{ fontSize: 13, color: 'var(--danger)' }}>
            ⚠️ Couldn't load your dogs/litters. Export is disabled until this succeeds — retry below.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={loadExportData}>Retry</button>
        </div>
      )}


      {/* Compliance notice */}
      <div style={{ background: 'var(--green-light)', border: '1px solid rgba(8,80,65,.12)', borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#0F6E56' }}>
        <strong>Review your records before sharing.</strong> Council facility evidence is optional for ordinary dog and breeding records. A Council report highlights missing or inconsistent information and does not verify approval conditions.
      </div>

      {/* Step 1 — Scope */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Step 1 — What to export
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 10 }}>
          {([
            { id: 'dog',     icon: '🐕', label: 'Single Dog',    desc: 'Health record for 1 dog' },
            { id: 'litter',  icon: '🐣', label: 'Litter',        desc: 'All puppies in a litter' },
            { id: 'kennel',  icon: '📋', label: 'All Dogs & Litters', desc: 'Full register for Council review' },
            { id: 'breeding',icon: '🌸', label: 'Breeding Compliance', desc: 'Heat cycles, litter history & state rules' },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => { setScope(opt.id); setSelectedDogId('') }}
              style={{
                padding: '14px 10px', borderRadius: 12, textAlign: 'center',
                border: `2px solid ${scope === opt.id ? 'var(--green)' : 'var(--border)'}`,
                background: scope === opt.id ? 'var(--green-light)' : 'var(--white)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>{opt.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: scope === opt.id ? 'var(--green)' : 'var(--dark)', marginBottom: 2 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: 'var(--light)' }}>{opt.desc}</div>
            </button>
          ))}
        </div>

        {/* Dog selector */}
        {scope === 'dog' && (
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Select dog</label>
            {loadError ? (
              <span className="form-hint">⚠️ Your dogs failed to load — retry above before selecting.</span>
            ) : (
              <select className="form-select" value={selectedDogId} onChange={e => setSelectedDogId(e.target.value)}>
                <option value="">— Choose a dog —</option>
                {dogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed})</option>)}
              </select>
            )}
          </div>
        )}

        {/* Litter selector */}
        {scope === 'litter' && (
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Select litter</label>
            {loadError ? (
              <span className="form-hint">⚠️ Your litters failed to load — retry above before selecting.</span>
            ) : (
              <select className="form-select" value={selectedLitterId} onChange={e => setSelectedLitterId(e.target.value)}>
                <option value="">— Choose a litter —</option>
                {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Kennel summary */}
        {scope === 'kennel' && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--mid)', background: 'var(--sand)', padding: '10px 14px', borderRadius: 8 }}>
            {loadError ? '⚠️ Kennel data unavailable — retry.' : <>📊 {dogs.length} dog records, {litters.length} litters, {movements.length} movement events and {dailyLogs.length} care logs.</>}
            <div style={{ marginTop: 8 }}>The dog and litter registers include historical account records. The selected dates apply to occupancy and daily care.</div>
            {(!facility.address || !facility.approvalNumber || !facility.approvalDocumentRef) && <div style={{ marginTop: 8, color: '#8A4B00' }}>⚠️ If Council needs facility approval evidence, add the address, approval number and document reference in the optional section below. Missing evidence is flagged in the report.</div>}
            {possibleTestDogs.length > 0 && <div style={{ marginTop: 8, color: '#8A4B00' }}>⚠️ {possibleTestDogs.length} possible test records need classification before sharing: {possibleTestDogs.map(d => d.name).join(', ')}. They remain visible in the report until the source records are resolved.</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
              <label>From <input type="date" className="form-input" value={period.from} onChange={e=>setPeriod({ ...period, from:e.target.value })} /></label>
              <label>To <input type="date" className="form-input" value={period.to} onChange={e=>setPeriod({ ...period, to:e.target.value })} /></label>
            </div>
          </div>
        )}

        {/* Breeding compliance — female dog selector */}
        {scope === 'breeding' && (
          <div style={{ marginTop: 16 }}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Select female dog</label>
              {loadError ? (
                <span className="form-hint">⚠️ Your dogs failed to load — retry above before selecting.</span>
              ) : (
                <>
                  <select className="form-select" value={selectedDogId} onChange={e => setSelectedDogId(e.target.value)}>
                    <option value="">— Choose a female dog —</option>
                    {femaleDogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed})</option>)}
                  </select>
                  {femaleDogs.length === 0 && (
                    <span className="form-hint">No female dogs in your account.</span>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--mid)', background: 'var(--sand)', padding: '10px 14px', borderRadius: 8, lineHeight: 1.6 }}>
              🌸 <strong>Breeding Compliance Report includes:</strong>
              <ul style={{ marginTop: 6, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <li>Current compliance status ({userState} state rules)</li>
                <li>Lifetime litter count vs. state maximum</li>
                <li>C-section history and limits (NSW-specific)</li>
                <li>Heat cycle records — actual dates, mating method, sire details</li>
                <li>Whelping history — dates, method, puppies born/alive</li>
                <li>Next eligible breeding date</li>
                <li>Predicted future heat cycle dates</li>
                <li>Dogs Australia / state law reference</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Step 2 — Format & Download */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Step 2 — Download
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)', marginBottom: 4 }}>PDF Report</div>
            <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 14 }}>
              {scope === 'breeding'
                ? 'Formatted breeding compliance report — suitable for Dogs Australia inspections.'
                : 'Formatted PDF report with a clear Draft review status — open, download or print when ready.'}
            </div>
            <button
              className="btn btn-primary btn-sm"
              style={{ width: '100%' }}
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null || loadError}
            >
              {exporting === 'pdf'
                ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> Generating…</>
                : '📄 Export PDF'}
            </button>
          </div>

          <div style={{ border: `1px solid ${scope === 'breeding' ? 'var(--border)' : 'var(--border)'}`, borderRadius: 12, padding: 16, opacity: scope === 'breeding' ? 0.5 : 1 }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>📊</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)', marginBottom: 4 }}>{scope === 'kennel' ? 'Council workbook' : 'CSV / Excel'}</div>
            <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 14 }}>
              {scope === 'breeding'
                ? 'CSV not available for breeding compliance — use PDF.'
                : scope === 'kennel' ? 'Excel workbook with summary, dogs, breeding events, puppies, health, sales/transfers, occupancy, care and data quality.' : 'Raw data export — open in Excel, Numbers, or Google Sheets.'}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%' }}
              onClick={() => scope === 'breeding' ? toast('Use PDF for breeding compliance reports', 'error') : handleExport(scope === 'kennel' ? 'xlsx' : 'csv')}
              disabled={exporting !== null || scope === 'breeding' || loadError}
            >
              {exporting === 'csv' || exporting === 'xlsx'
                ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generating…</>
                : scope === 'kennel' ? '📊 Export Excel' : '📊 Export CSV'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--light)' }}>
          💡 PDF opens in a new tab. Use the PDF viewer toolbar to download or print when needed.
        </div>
      </div>

      {scope === 'kennel' && <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 16, fontWeight: 600, color: 'var(--dark)' }}>Optional Council facility and occupancy records</summary>
        <p style={{ fontSize: 13, color: 'var(--mid)', marginTop: 10 }}>Use this section when your Council requests facility approval, arrival/departure or daily care evidence. Dog and litter exports do not require these entries.</p>
        <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Facility & Council report details</h2>
        <p style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 16 }}>Enter the wording and limits from your own approval. Keep its document available for review.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          {([['facilityName','Facility name'],['address','Facility address'],['council','Council'],['approvalNumber','Approval / DA number'],['approvalDocumentRef','Approval document reference'],['ledgerStartDate','Movement ledger complete from (YYYY-MM-DD)'],['breedingFemale','Approved breeding females'],['breedingMale','Approved breeding males'],['boarding','Approved boarding dogs']] as const).map(([key,label]) => <label key={key} className="form-group"><span className="form-label">{label}</span><input className="form-input" type={key === 'ledgerStartDate' ? 'date' : key.startsWith('breeding') || key === 'boarding' ? 'number' : 'text'} value={facility[key]} onChange={e => setFacility({ ...facility, [key]: e.target.value })} /></label>)}
        </div>
        <label className="form-group"><span className="form-label">Approval conditions / evidence notes</span><textarea className="form-input" rows={3} value={facility.conditionNotes} onChange={e=>setFacility({ ...facility, conditionNotes: e.target.value })} /></label>
        <label style={{ display: 'block', fontSize: 13, margin: '12px 0' }}><input type="checkbox" checked={facility.ledgerAttested} onChange={e=>setFacility({ ...facility, ledgerAttested: e.target.checked })} /> I confirm every dog present from the ledger start has an arrival entry, and subsequent arrivals/departures are complete.</label>
        <button className="btn btn-secondary btn-sm" disabled={saving || loadError} onClick={()=>saveKennelData('saveFacility', { facility })}>Save facility details</button>
        <h3 style={{ marginTop: 22 }}>Arrival / departure</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
          <select className="form-select" aria-label="Dog" value={movement.dogId} onChange={e=>setMovement({ ...movement, dogId: e.target.value })}><option value="">Choose dog</option>{dogs.map(d=><option value={d.id} key={d.id}>{d.name} · {d.id}</option>)}</select>
          <select className="form-select" aria-label="Direction" value={movement.direction} onChange={e=>setMovement({ ...movement, direction: e.target.value })}><option value="arrival">Arrival</option><option value="departure">Departure</option></select>
          <select className="form-select" aria-label="Category" value={movement.category} onChange={e=>setMovement({ ...movement, category: e.target.value })}><option value="breeding">Breeding</option><option value="boarding">Boarding</option><option value="puppy">Puppy</option><option value="other">Other</option></select>
          <input className="form-input" aria-label="Date and time" type="datetime-local" value={movement.occurredAt} onChange={e=>setMovement({ ...movement, occurredAt: e.target.value })} />
          <input className="form-input" aria-label="Movement note" placeholder="Reason / reference" value={movement.note} onChange={e=>setMovement({ ...movement, note: e.target.value })} />
          <button className="btn btn-secondary btn-sm" disabled={saving || !movement.dogId || !movement.occurredAt} onClick={()=>saveKennelData('addMovement', { movement: { ...movement, occurredAt: new Date(movement.occurredAt).toISOString() } })}>Record movement</button>
        </div>
        <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 12 }}>{movements.filter(m=>!m.voidedAt).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).slice(0,20).map(m=><div key={m.id} style={{ padding: 4, borderBottom: '1px solid var(--border)' }}>{m.occurredAt} · {m.direction} · {dogs.find(d=>d.id===m.dogId)?.name || m.dogId} ({m.category}) <button className="btn btn-secondary btn-sm" disabled={saving} onClick={()=>{ const reason = window.prompt('Reason for voiding this entry (kept in audit history):'); if (reason) saveKennelData('voidMovement',{ id:m.id, reason }) }}>Void</button></div>)}</div>
        <h3 style={{ marginTop: 22 }}>Daily care log</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
          <input className="form-input" aria-label="Care date" type="date" value={dailyLog.date} onChange={e=>setDailyLog({ ...dailyLog, date:e.target.value })} />
          <input className="form-input" aria-label="Caretaker" placeholder="Caretaker" value={dailyLog.caretaker} onChange={e=>setDailyLog({ ...dailyLog, caretaker:e.target.value })} />
          <input className="form-input" aria-label="Exercise minutes" type="number" min="0" max="1440" placeholder="Exercise minutes" value={dailyLog.exerciseMinutes} onChange={e=>setDailyLog({ ...dailyLog, exerciseMinutes:e.target.value })} />
          <input className="form-input" aria-label="Care notes" placeholder="Cleaning, water, feeding" value={dailyLog.careNotes} onChange={e=>setDailyLog({ ...dailyLog, careNotes:e.target.value })} />
          <input className="form-input" aria-label="Incidents" placeholder="Incident / none observed" value={dailyLog.incidentNotes} onChange={e=>setDailyLog({ ...dailyLog, incidentNotes:e.target.value })} />
          <button className="btn btn-secondary btn-sm" disabled={saving} onClick={()=>saveKennelData('saveDailyLog', { dailyLog })}>Save daily log</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mid)' }}>{dailyLogs.length} daily logs recorded. Edits replace the day's display values; confirm against your source diary.</div>
        </div>
      </details>}

    </div>
  )
}
