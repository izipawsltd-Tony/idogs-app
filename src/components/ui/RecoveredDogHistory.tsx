import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { auth } from '../../lib/firebase'
import { formatDate } from '../../lib/utils'

const sections = [
  ['Overview', 'overview'], ['Vaccines', 'vaccineRecords'], ['Worming', 'wormingRecords'],
  ['Health tests', 'healthTests'], ['Timeline', 'activityNotes'], ['Photos', 'photos'],
  ['Documents', 'documents'], ['Reminders', 'reminders'], ['Breeding', 'heatCycles'], ['Activity', 'auditEntries'],
] as const
type History = {
  id: string; dogId: string; dog?: { name?: string }; transferredAt: string
  [key: string]: any
}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const detailFields = [['nextDue', 'Next due'], ['vetClinic', 'Vet clinic'], ['batchNumber', 'Batch number'], ['weightKg', 'Weight (kg)'], ['certNumber', 'Certificate number'], ['lab', 'Laboratory'], ['status', 'Status'], ['completedAt', 'Completed']] as const

export default function RecoveredDogHistory({ history }: { history: History }) {
  const [tab, setTab] = useState<string>('overview')
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([])
  const [photoState, setPhotoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [unavailable, setUnavailable] = useState(0)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setPhotos([]); setPhotoState('idle'); setUnavailable(0)
    if (tab !== 'photos') return () => { active = false }
    setPhotoState('loading')
    ;(async () => {
      try {
        const user = auth.currentUser
        if (!user) throw Error('Sign in required')
        const token = await user.getIdToken()
        const res = await fetch('/api/get-history-media', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ dogId: history.dogId, snapshotId: history.id }),
        })
        if (!res.ok) throw Error('Unavailable')
        const data = await res.json()
        if (active) { setPhotos(data.photos || []); setUnavailable(data.unavailable || 0); setPhotoState('ready') }
      } catch { if (active) setPhotoState('error') }
    })()
    return () => { active = false }
  }, [history.id, history.dogId, tab, attempt])

  const records: Array<Record<string, unknown>> = history[tab] || []
  const title = sections.find(s => s[1] === tab)?.[0]
  return <div style={{ padding: 24 }}>
    <Link to="/app/dogs">← My dogs</Link>
    <h1 style={{ marginTop: 20 }}>{history.dog?.name || 'Transferred dog'}</h1>
    <p>Transferred · Read-only history · {formatDate(history.transferredAt)}</p>
    <div role="status" className="card" style={{ padding: 16, margin: '16px 0', background: 'var(--sand)' }}>
      This older transfer has a partially recovered history. Only records verified to exist before transfer are shown.
      Some original details may be missing. Updates made by the new owner are private.
    </div>
    <nav aria-label="Dog history" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12 }}>
      {sections.map(([label, key]) => <button key={key} aria-pressed={tab === key}
        className={tab === key ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
        style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTab(key)}>{label}</button>)}
    </nav>
    <section aria-label={title} className="card" style={{ padding: 20 }}>
      {tab === 'overview' ? <>
        <h2>Profile at transfer</h2><p>Name: {history.dog?.name}</p>
        <p>Transferred: {formatDate(history.transferredAt)}</p>
        <p>Other profile details and the original profile photo could not be verified. Recovered photos are available in Photos.</p>
      </> : tab === 'photos' ? <>
        <h2>Photos before transfer</h2>
        {photoState === 'loading' && <p>Loading historical photos…</p>}
        {photoState === 'error' && <p role="alert">Historical photos could not be loaded.</p>}
        {(photoState === 'error' || photoState === 'ready') && <button className="btn btn-secondary btn-sm" onClick={() => setAttempt(a => a + 1)}>{photoState === 'error' ? 'Retry' : 'Refresh photos'}</button>}
        {photoState === 'ready' && <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
            {photos.map((photo, i) => <img key={photo.id} src={photo.url} alt={`Photo before transfer ${i + 1}`} loading="lazy"
              style={{ width: '100%', maxWidth: 400, borderRadius: 12 }} />)}
          </div>
          {!photos.length && <p>No historical photos could be recovered.</p>}
          {unavailable > 0 && <p>{unavailable} historical photo(s) are currently unavailable.</p>}
        </>}
      </> : <>
        <h2>{title} before transfer</h2>
        {records.length ? records.map((record, i) => <article key={text(record.id) || i} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <strong>{text(record.name || record.product || record.title || record.testType || record.type || record.action) || 'Historical record'}</strong>
          <p>{text(record.text || record.note || record.notes || record.details || record.result)}</p>
          <time>{formatDate(text(record.dateGiven || record.dateTested || record.noteDate || record.date || record.dueDate || record.startDate || record.createdAt))}</time>
          <dl>{detailFields.filter(([key]) => text(record[key])).map(([key, label]) => <div key={key} style={{ display: 'flex', gap: 12, marginTop: 8 }}><dt>{label}</dt><dd style={{ margin: 0 }}>{text(record[key])}</dd></div>)}</dl>
        </article>) : <p>No records could be recovered for this section. This does not confirm that none existed.</p>}
      </>}
    </section>
  </div>
}
