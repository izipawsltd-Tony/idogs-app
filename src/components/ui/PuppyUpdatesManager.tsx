import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { getDogs, uploadShowcaseMediaDirect, isCurrentOwner, managePrivateDogAccess, type SignedMediaItem } from '../../lib/db'
import { prepareImageForUpload } from '../../lib/imageCompression'
import { puppyUpdates, puppyPath, puppyShareUrl, type PuppyStory, type UpdateAudience } from '../../lib/puppyUpdates'
import type { Dog } from '../../types'
import PuppyUpdateFeed, { AUDIENCE_LABELS } from './PuppyUpdateFeed'

type SelectableMedia = SignedMediaItem & { kind: 'photo' | 'video' }
export default function PuppyUpdatesManager({ dog }: { dog: Dog }) {
  const { user } = useAuth()
  const [story, setStory] = useState<PuppyStory | null>(null)
  const [gallery, setGallery] = useState<SelectableMedia[]>([])
  const [siblings, setSiblings] = useState<Dog[]>([])
  const [selectedDogs, setSelectedDogs] = useState<string[]>([dog.id])
  const [selectedMedia, setSelectedMedia] = useState<string[]>([])
  const [text, setText] = useState('')
  const [date, setDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
  const [audience, setAudience] = useState<UpdateAudience>('internal')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [ready, setReady] = useState(false)
  const [buyerEmail, setBuyerEmail] = useState(dog.reservedForEmail || '')
  const [grantedEmail, setGrantedEmail] = useState('')
  const editable = isCurrentOwner(dog, user?.uid || '') && dog.status !== 'transferred'
  useEffect(() => {
    let active = true
    setStory(null); setReady(false)
    async function load() {
      try {
        const data = await puppyUpdates({ dogId: dog.id, action: 'view' })
        if (!active) return
        setStory(data)
        if (editable) {
          const [media, dogs] = await Promise.all([puppyUpdates<{ media: SelectableMedia[] }>({ action: 'gallery', dogId: dog.id }), getDogs()])
          if (!active) return
          setGallery(media.media)
          setSiblings(dogs.filter(d => d.id !== dog.id && !!dog.litterId && d.litterId === dog.litterId && isCurrentOwner(d, user!.uid) && d.status !== 'transferred' && d.status !== 'restricted'))
          if (dog.tenantId === user?.uid && dog.depositStatus === 'received') {
            const grant = await managePrivateDogAccess(dog.id, 'get')
            if (!active) return
            setGrantedEmail(grant?.buyerEmail || '')
            if (grant?.buyerEmail) setBuyerEmail(grant.buyerEmail)
          }
        }
        setReady(true)
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not load updates') }
    }
    void load()
    return () => { active = false }
  }, [dog.id, dog.litterId, dog.tenantId, dog.depositStatus, user?.uid, editable, refresh])
  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('')
    try { await task(); setMessage(success); setRefresh(v => v + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Please retry') } finally { setBusy(false) }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError(''); setMessage('')
    const uploaded: string[] = []
    try {
      if (files.length + selectedMedia.length > 12) throw new Error('Select up to 12 files per update')
      for (const file of Array.from(files)) {
        let result
        if (file.type.startsWith('video/')) result = await uploadShowcaseMediaDirect(dog.id, 'video', file, file.type, 'puppy-update')
        else { const prepared = await prepareImageForUpload(file); result = await uploadShowcaseMediaDirect(dog.id, 'photo', prepared.base64, prepared.mediaType, 'puppy-update') }
        uploaded.push(result.mediaId)
      }
      setMessage('Media uploaded privately. Publish the update when you are ready.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Please retry.') }
    finally { setSelectedMedia(ids => [...new Set([...ids, ...uploaded])]); setRefresh(v => v + 1); setBusy(false) }
  }
  function changed() { setRequestId(crypto.randomUUID()) }
  return <section className="card" aria-label="Share puppy updates" style={{ padding: 18, marginBottom: 24 }}>
    <h3 style={{ margin: '0 0 8px' }}>📷 Photos &amp; customer updates</h3>
    <p style={{ fontSize: 13, color: 'var(--mid)' }}>Post here to update this puppy’s permanent QR profile. Your existing story notes below stay private.</p>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
      <Link className="btn btn-secondary btn-sm" to={puppyPath(dog.passportId)} target="_blank" rel="noreferrer">Preview QR profile</Link>
      <button className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard.writeText(puppyShareUrl(dog.passportId)).then(() => setMessage('Permanent puppy link copied')).catch(() => setError('Could not copy. Open the QR profile and copy its address.')) }}>Copy permanent link</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRefresh(v => v + 1)}>Refresh</button>
    </div>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}{message && <p role="status" style={{ color: 'var(--brand-600)' }}>{message}</p>}
    {!ready && !error && <div className="spinner" />}
    {editable && story && <>
      <label style={{ display: 'block', fontSize: 13, margin: '14px 0' }}><input type="checkbox" checked={story.publicEnabled} disabled={busy || !ready} onChange={e => void run(() => puppyUpdates({ action: 'settings', dogId: dog.id, publicEnabled: e.target.checked }), 'QR story sharing updated')} /> Allow public updates on this QR profile</label>
      <p style={{ fontSize: 12, color: 'var(--mid)' }}>Only updates marked Public appear to visitors. Public story sharing pauses when ownership changes; the new owner decides what to publish.</p>
      {dog.tenantId === user?.uid && dog.depositStatus === 'received' && <fieldset disabled={busy || !ready} style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 10, marginBottom: 16 }}><legend>Deposited buyer access</legend><p style={{ fontSize: 12 }}>The buyer signs in with this verified email to view private updates on the same QR profile. This does not transfer ownership.</p><label className="form-label" htmlFor="puppy-buyer-email">Buyer email</label><input id="puppy-buyer-email" className="form-input" type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} />{grantedEmail && <p style={{ fontSize: 12 }}>Access active for {grantedEmail}</p>}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><button className="btn btn-secondary btn-sm" disabled={!buyerEmail.trim()} onClick={() => void run(async () => { if (grantedEmail && grantedEmail.toLowerCase() !== buyerEmail.trim().toLowerCase() && !window.confirm('Replace the current buyer’s private access? Their access will stop.')) return; await managePrivateDogAccess(dog.id, 'grant', buyerEmail) }, 'Buyer access saved. Send them the permanent puppy link.')}>{grantedEmail ? 'Update buyer access' : 'Grant buyer access'}</button>{grantedEmail && <button className="btn btn-ghost btn-sm" onClick={() => void run(() => managePrivateDogAccess(dog.id, 'revoke'), 'Buyer private access revoked')}>Revoke access</button>}</div></fieldset>}
      <fieldset disabled={busy || !ready} style={{ border: 0, padding: 0, margin: '16px 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: 10 }}>Add a photo / video update</legend>
        <label className="form-label" htmlFor="puppy-update-date">Update date</label><input id="puppy-update-date" className="form-input" type="date" value={date} onChange={e => { setDate(e.target.value); changed() }} style={{ maxWidth: 200, marginBottom: 10 }} />
        <label className="form-label" htmlFor="puppy-update-text">What’s new?</label><textarea id="puppy-update-text" className="form-textarea" maxLength={3000} value={text} placeholder="Week 5 — exploring the garden together…" onChange={e => { setText(e.target.value); changed() }} style={{ minHeight: 80, width: '100%' }} />
        <label className="form-label" htmlFor="puppy-update-audience" style={{ marginTop: 12 }}>Who can see this update?</label><select id="puppy-update-audience" className="form-select" value={audience} onChange={e => { setAudience(e.target.value as UpdateAudience); changed() }}>{Object.entries(AUDIENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {audience === 'public' && !story.publicEnabled && <p style={{ fontSize: 12, color: 'var(--warning)' }}>Public sharing is off. Enable it above before visitors can see public updates.</p>}
        {audience === 'buyer' && <p style={{ fontSize: 12, color: 'var(--mid)' }}>Private updates require buyer access after the deposit is marked Received. Following alone does not unlock them.</p>}
        {siblings.length > 0 && <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, margin: '12px 0', padding: 12 }}><legend>Also add to littermates</legend><p style={{ fontSize: 12 }}>Use group media only when every selected puppy’s viewer may see it. Public sharing is controlled separately for each puppy.</p>{siblings.map(sibling => <label key={sibling.id} style={{ display: 'block', margin: '6px 0' }}><input type="checkbox" checked={selectedDogs.includes(sibling.id)} onChange={e => { setSelectedDogs(ids => e.target.checked ? [...ids, sibling.id] : ids.filter(id => id !== sibling.id)); changed() }} /> {sibling.name}</label>)}</fieldset>}
        <label style={{ display: 'block', margin: '14px 0' }}>Upload photos / videos <input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" onChange={e => { void upload(e.target.files); e.target.value = ''; changed() }} /></label>
        <p style={{ fontSize: 12, color: 'var(--mid)' }}>Videos up to 20 MB. Select up to 12 items per update. Recent uploads are shown below; older published media stays in the story. Files stay private until shared.</p>
        {!!gallery.length && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 14 }}>{gallery.map(media => <label key={media.id} style={{ padding: 5, border: selectedMedia.includes(media.id) ? '2px solid var(--brand-600)' : '1px solid var(--border)', borderRadius: 8 }}>
          {media.kind === 'photo' ? <img src={media.url} alt="Gallery selection" style={{ width: '100%', height: 80, objectFit: 'cover' }} /> : <video src={media.url} preload="metadata" muted style={{ width: '100%', height: 80 }} />}
          <span style={{ fontSize: 12 }}><input type="checkbox" checked={selectedMedia.includes(media.id)} onChange={e => { setSelectedMedia(ids => e.target.checked ? [...ids, media.id] : ids.filter(id => id !== media.id)); changed() }} /> {media.kind === 'photo' ? 'Photo' : 'Video'}</span>
        </label>)}</div>}
        <button className="btn btn-primary" disabled={!text.trim() || selectedMedia.length > 12 || selectedDogs.length > 12} onClick={() => void run(async () => { await puppyUpdates({ action: 'create', dogIds: [dog.id, ...selectedDogs.filter(id => id !== dog.id)], requestId, text, date, audience, mediaIds: selectedMedia }); setText(''); setSelectedMedia([]); setSelectedDogs([dog.id]); changed() }, 'Update saved. Customers can use the same puppy link to view shared updates.')}>{busy ? 'Saving…' : audience === 'internal' ? 'Save private update' : 'Publish update'}</button>
      </fieldset>
    </>}
    {story && <PuppyUpdateFeed updates={story.updates} busy={busy} manage={editable ? (id, action, visibility) => void run(() => puppyUpdates({ action, dogId: dog.id, updateId: id, audience: visibility }), 'Update changed') : undefined} />}
    {story?.nextCursor && <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const data = await puppyUpdates({ action: 'view', dogId: dog.id, cursor: story.nextCursor }); setStory(previous => previous ? { ...data, updates: [...previous.updates, ...data.updates] } : data) } catch (e) { setError(e instanceof Error ? e.message : 'Please retry') } finally { setBusy(false) } }}>Load older updates</button>}
  </section>
}
