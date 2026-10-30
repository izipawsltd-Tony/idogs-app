import { useState } from 'react'
import PuppyMediaViewer from './PuppyMediaViewer'
import type { PuppyUpdate, UpdateAudience } from '../../lib/puppyUpdates'

export const AUDIENCE_LABELS: Record<UpdateAudience, string> = { internal: 'Only me', public: 'Public on QR profile', buyer: 'Deposited buyer only' }

export default function PuppyUpdateFeed({ updates, galleryUpdates, manage, busy, edit }: { updates: PuppyUpdate[]; galleryUpdates?: PuppyUpdate[]; busy?: boolean; edit?: (update: PuppyUpdate) => void; manage?: (id: string, action: 'delete' | 'visibility', audience?: UpdateAudience) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const gallery = (galleryUpdates || updates).flatMap(update => update.media.map(media => ({ ...media, key: `${update.id}:${media.id}`, caption: update.text })))
  if (!updates.length) return <p style={{ color: 'var(--mid)', padding: '18px 0' }}>No updates shared here yet. Check back to follow their story.</p>
  return <div style={{ display: 'grid', gap: 16 }}>{updates.map(update => <article key={update.id} className="card" style={{ padding: 16, minWidth: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <time dateTime={update.date} style={{ fontSize: 13, color: 'var(--mid)' }}>{new Date(`${update.date}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
      {manage && <span style={{ fontSize: 12, color: 'var(--brand-600)' }}>{AUDIENCE_LABELS[update.audience]}{update.inherited ? ' · From previous owner' : ''}</span>}
    </div>
    {!!update.text && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '10px 0' }}>{update.text}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
      {update.media.map(media => media.kind === 'photo'
        ? <button key={media.id} type="button" aria-label="Enlarge update photo" onClick={() => setExpanded(`${update.id}:${media.id}`)} style={{ border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in' }}><img src={media.url} alt="Puppy update" loading="lazy" style={{ width: '100%', height: 180, objectFit: 'contain', borderRadius: 8, background: 'var(--sand)' }} /></button>
        : <div key={media.id}><video src={media.url} controls playsInline preload="metadata" style={{ width: '100%', height: 180, borderRadius: 8, background: '#111' }} /><button type="button" className="btn btn-secondary btn-sm" onClick={event => { event.currentTarget.parentElement?.querySelector('video')?.pause(); setExpanded(`${update.id}:${media.id}`) }}>Open video in gallery</button></div>)}
    </div>
    {manage && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
      {!update.inherited && edit && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => edit(update)}>Edit</button>}
      {!update.inherited && <label style={{ fontSize: 12 }}>Who can see this? <select aria-label="Update visibility" disabled={busy} value={update.audience} onChange={e => manage(update.id, 'visibility', e.target.value as UpdateAudience)}>{Object.entries(AUDIENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm('Remove this update from this puppy’s story?')) manage(update.id, 'delete') }}>Remove update</button>
    </div>}
  </article>)}{expanded && gallery.length > 0 && <PuppyMediaViewer items={gallery} initialKey={expanded} close={() => setExpanded(null)} />}</div>
}
