import { useEffect, useState } from 'react'
import type { HealthTest, VaccineRecord } from '../../types'
import { formatDate } from '../../lib/utils'

// Former owner's read-only QR Passport, exactly as it stood at transfer.
// Everything comes from the immutable transfer snapshot: the snapshot's dog,
// its vaccine and health-test records, and the snapshot's own photo paths
// (signed by api/get-showcase-media-urls, which uses the snapshot for anyone
// who is not the current owner). It never opens the live passport, so later
// changes and the new owner's details are never shown.
type SnapshotDog = {
  name?: string; breed?: string; sex?: string; dateOfBirth?: string; colour?: string
  passportId?: string; profilePhoto?: string | null; photos?: unknown[]
}
type Photo = { id: string; url: string }

// Same public fields as the live QR passport (api/passport.js allowlist).
export function passportInfoRows(dog: SnapshotDog): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [
    ['Name', dog.name], ['Breed', dog.breed],
    ['Sex', dog.sex === 'female' ? 'Female' : dog.sex === 'male' ? 'Male' : undefined],
    ['Date of birth', dog.dateOfBirth ? formatDate(dog.dateOfBirth) : undefined],
    ['Colour', dog.colour], ['Dog ID', dog.passportId],
  ]
  return rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1].trim() !== '')
}

export default function HistoricalPassport({ dog, transferredAt, vaccines, healthTests, loadPhotos }: {
  dog: SnapshotDog
  transferredAt?: string
  vaccines: VaccineRecord[]
  healthTests: HealthTest[]
  loadPhotos: () => Promise<{ photos: Photo[] }>
}) {
  const [tab, setTab] = useState<'vaccines' | 'health' | 'info' | 'photos'>('vaccines')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [photoState, setPhotoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  const hasSnapshotPhotos = Array.isArray(dog.photos) && dog.photos.length > 0

  useEffect(() => {
    let active = true
    if (tab !== 'photos' || !hasSnapshotPhotos) return () => { active = false }
    setPhotoState('loading')
    loadPhotos()
      .then(r => { if (active) { setPhotos(r.photos || []); setPhotoState('ready') } })
      .catch(() => { if (active) setPhotoState('error') })
    return () => { active = false }
  }, [tab, attempt, hasSnapshotPhotos])

  const tabs = [['vaccines', 'Vaccines'], ['health', 'Health'], ['info', 'Info'], ['photos', 'Photos']] as const
  return (
    <div className="card" style={{ padding: 20 }} data-testid="historical-passport">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <div aria-hidden style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, border: '2px solid var(--border)',
          background: dog.profilePhoto ? `url(${dog.profilePhoto}) center/cover` : 'var(--green-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{!dog.profilePhoto && '🐕'}</div>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, margin: 0 }}>QR Passport at transfer</h2>
          <div style={{ fontSize: 13, color: 'var(--mid)' }}>
            {dog.passportId || 'Dog ID not recorded'}{transferredAt ? ` · as at ${formatDate(transferredAt)}` : ''}
          </div>
        </div>
      </div>
      <div role="status" style={{ fontSize: 12, color: 'var(--mid)', background: '#F7F4EC', border: '1px solid var(--border)', padding: '8px 10px', borderRadius: 8, marginBottom: 12 }}>
        🔒 Read-only. This is the passport as it was when you transferred this dog. Changes and photos added by the new owner are private and are not shown.
      </div>
      <nav aria-label="Passport at transfer" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12 }}>
        {tabs.map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}
          className={tab === id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</button>)}
      </nav>

      {tab === 'vaccines' && (vaccines.length === 0
        ? <p style={{ color: 'var(--mid)' }}>No vaccines were recorded at transfer.</p>
        : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{vaccines.slice().sort((a, b) => String(b.dateGiven).localeCompare(String(a.dateGiven))).map(v =>
            <li key={v.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 500 }}>{v.name}</div>
              <div style={{ fontSize: 12, color: 'var(--light)' }}>Given: {formatDate(v.dateGiven)}{v.nextDue ? ` · Next due: ${formatDate(v.nextDue)}` : ''}{v.vetClinic ? ` · ${v.vetClinic}` : ''}</div>
            </li>)}</ul>)}

      {tab === 'health' && (healthTests.length === 0
        ? <p style={{ color: 'var(--mid)' }}>No health tests were recorded at transfer.</p>
        : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{healthTests.map(h =>
            <li key={h.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 500 }}>{String(h.testType || 'Health test')}{typeof h.result === 'string' && h.result ? ` — ${h.result}` : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--light)' }}>{h.dateTested ? `Tested: ${formatDate(h.dateTested)}` : ''}{h.lab ? ` · ${h.lab}` : ''}</div>
            </li>)}</ul>)}

      {tab === 'info' && <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
        {passportInfoRows(dog).map(([k, v]) => [<dt key={`${k}-k`} style={{ color: 'var(--mid)' }}>{k}</dt>, <dd key={`${k}-v`} style={{ margin: 0 }}>{v}</dd>])}
      </dl>}

      {tab === 'photos' && (!hasSnapshotPhotos
        ? <p style={{ color: 'var(--mid)' }}>No gallery photos were saved at transfer.</p>
        : photoState === 'loading' || photoState === 'idle' ? <div className="spinner" />
        : photoState === 'error' ? <div><p>Photos from transfer are unavailable right now.</p><button className="btn btn-secondary btn-sm" onClick={() => setAttempt(a => a + 1)}>Retry</button></div>
        : photos.length === 0 ? <p style={{ color: 'var(--mid)' }}>These photos are no longer available.</p>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {photos.map(p => <img key={p.id} src={p.url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} />)}
          </div>)}
    </div>
  )
}
