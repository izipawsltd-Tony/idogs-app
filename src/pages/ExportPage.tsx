import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getDogs, getLitters } from '../lib/db'
import type { Dog, Litter, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type Scope = 'dog' | 'litter' | 'kennel' | 'breeding'
type Format = 'pdf' | 'csv'

export default function ExportPage({ toast }: Props) {
  const { user, profile } = useAuth()
  const [dogs, setDogs] = useState<Dog[]>([])
  const [litters, setLitters] = useState<Litter[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('kennel')
  const [selectedDogId, setSelectedDogId] = useState('')
  const [selectedLitterId, setSelectedLitterId] = useState('')
  const [exporting, setExporting] = useState<Format | null>(null)
  const userState = (profile as any)?.state || 'SA'

  // Female dogs only for breeding compliance
  const femaleDogs = dogs.filter(d => d.sex === 'female' && (d as any).status !== 'transferred')

  useEffect(() => {
    if (!user) return
    Promise.all([getDogs(), getLitters()])
      .then(([d, l]) => { setDogs(d); setLitters(l) })
      .catch(() => toast('Failed to load data', 'error'))
      .finally(() => setLoading(false))
  }, [user])

  async function handleExport(format: Format) {
    if (!user) return
    if (scope === 'dog' && !selectedDogId) { toast('Please select a dog', 'error'); return }
    if (scope === 'litter' && !selectedLitterId) { toast('Please select a litter', 'error'); return }
    if (scope === 'breeding' && !selectedDogId) { toast('Please select a female dog', 'error'); return }

    setExporting(format)
    try {
      const res = await fetch('/api/export-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          id: scope === 'dog' ? selectedDogId : scope === 'litter' ? selectedLitterId : scope === 'breeding' ? selectedDogId : null,
          tenantId: user.uid,
          format,
          userState,
        }),
      })

      if (!res.ok) throw new Error('Export failed')

      if (format === 'csv') {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const contentDisp = res.headers.get('Content-Disposition') || ''
        const match = contentDisp.match(/filename="(.+)"/)
        a.download = match ? match[1] : 'export.csv'
        a.click()
        URL.revokeObjectURL(url)
        toast('CSV downloaded ✓', 'success')
      } else {
        const { html, filename } = await res.json()
        const win = window.open('', '_blank')
        if (win) {
          win.document.write(html)
          win.document.close()
          setTimeout(() => {
            win.document.title = filename
            win.print()
          }, 500)
        }
        toast('PDF ready — use Print → Save as PDF ✓', 'success')
      }
    } catch {
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
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
        Export & Compliance Reports
      </h1>
      <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 32 }}>
        Generate audit reports for Dogs Australia inspections, state compliance, and personal records.
      </p>

      {/* Compliance notice */}
      <div style={{ background: 'var(--green-light)', border: '1px solid rgba(8,80,65,.12)', borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#0F6E56' }}>
        🇦🇺 <strong>Australian Universal Compliance Report</strong> — covers NSW Puppy Farm Act 2024, VIC Pet Exchange Register, QLD Animal Management Act, SA Dog and Cat Management Act, and WA Dog Act requirements.
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
            { id: 'kennel',  icon: '🏠', label: 'Full Kennel',   desc: 'All dogs + litters' },
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
            <select className="form-select" value={selectedDogId} onChange={e => setSelectedDogId(e.target.value)}>
              <option value="">— Choose a dog —</option>
              {dogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed})</option>)}
            </select>
          </div>
        )}

        {/* Litter selector */}
        {scope === 'litter' && (
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Select litter</label>
            <select className="form-select" value={selectedLitterId} onChange={e => setSelectedLitterId(e.target.value)}>
              <option value="">— Choose a litter —</option>
              {litters.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}

        {/* Kennel summary */}
        {scope === 'kennel' && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--mid)', background: 'var(--sand)', padding: '10px 14px', borderRadius: 8 }}>
            📊 Will include <strong>{dogs.length} dogs</strong> and <strong>{litters.length} litters</strong> — all health records, vaccines, and transfers.
          </div>
        )}

        {/* Breeding compliance — female dog selector */}
        {scope === 'breeding' && (
          <div style={{ marginTop: 16 }}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Select female dog</label>
              <select className="form-select" value={selectedDogId} onChange={e => setSelectedDogId(e.target.value)}>
                <option value="">— Choose a female dog —</option>
                {femaleDogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed})</option>)}
              </select>
              {femaleDogs.length === 0 && (
                <span className="form-hint">No female dogs in your account.</span>
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
                : 'Professional formatted report — print or save as PDF for inspectors.'}
            </div>
            <button
              className="btn btn-primary btn-sm"
              style={{ width: '100%' }}
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null}
            >
              {exporting === 'pdf'
                ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> Generating…</>
                : '📄 Export PDF'}
            </button>
          </div>

          <div style={{ border: `1px solid ${scope === 'breeding' ? 'var(--border)' : 'var(--border)'}`, borderRadius: 12, padding: 16, opacity: scope === 'breeding' ? 0.5 : 1 }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>📊</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)', marginBottom: 4 }}>CSV / Excel</div>
            <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 14 }}>
              {scope === 'breeding'
                ? 'CSV not available for breeding compliance — use PDF.'
                : 'Raw data export — open in Excel, Numbers, or Google Sheets.'}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%' }}
              onClick={() => scope === 'breeding' ? toast('Use PDF for breeding compliance reports', 'error') : handleExport('csv')}
              disabled={exporting !== null || scope === 'breeding'}
            >
              {exporting === 'csv'
                ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generating…</>
                : '📊 Export CSV'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--light)' }}>
          💡 For PDF: a new window will open — use <strong>File → Print → Save as PDF</strong> to save.
        </div>
      </div>
    </div>
  )
}
