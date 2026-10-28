import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { getDogs, uploadShowcaseMediaDirect, isCurrentOwner, managePrivateDogAccess, type SignedMediaItem } from '../../lib/db'
import { prepareImageForUpload } from '../../lib/imageCompression'
import { puppyUpdates, puppyPath, puppyShareUrl, type PuppyStory, type PuppyUpdate, type UpdateAudience } from '../../lib/puppyUpdates'
import type { Dog } from '../../types'
import PuppyUpdateFeed, { AUDIENCE_LABELS } from './PuppyUpdateFeed'

type SelectableMedia = SignedMediaItem & { kind: 'photo' | 'video' }
export default function PuppyUpdatesManager({ dog, onUpdates, onEditReady }: { dog: Dog; onUpdates?: (updates: PuppyUpdate[]) => void; onEditReady?: (edit: (update: PuppyUpdate) => void) => void }) {
  const composer = useRef<HTMLFieldSetElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const sharingLock = useRef(false)
  const [sharingBusy, setSharingBusy] = useState(false)
  const [sharingMessage, setSharingMessage] = useState('')
  const [group, setGroup] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [editing, setEditing] = useState<PuppyUpdate | null>(null)
  const { user } = useAuth()
  const [story, setStory] = useState<PuppyStory | null>(null)
  const [gallery, setGallery] = useState<SelectableMedia[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [siblingsLoading, setSiblingsLoading] = useState(false)
  const [buyerReady, setBuyerReady] = useState(false)
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
    setError('')
    async function load() {
      try {
        const data = await puppyUpdates({ dogId: dog.id, action: 'view' })
        if (!active) return
        setStory(data); onUpdates?.(data.updates)
        setReady(true)
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not load updates') }
    }
    void load()
    return () => { active = false }
  }, [dog.id, dog.litterId, dog.tenantId, dog.depositStatus, user?.uid, editable, refresh, onUpdates])
  const needsGallery = showLibrary || selectedMedia.some(id => !gallery.some(m => m.id === id) && !editing?.media.some(m => m.id === id))
  useEffect(() => {
    if (!editable || !needsGallery) return
    let active = true
    setGalleryLoading(true)
    void puppyUpdates<{ media: SelectableMedia[] }>({ action: 'gallery', dogId: dog.id }).then(data => { if (active) setGallery(data.media) }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load uploaded media') }).finally(() => { if (active) setGalleryLoading(false) })
    return () => { active = false }
  }, [dog.id, user?.uid, editable, needsGallery, refresh])
  useEffect(() => {
    if (!editable || !group || !dog.litterId) return
    let active = true
    setSiblingsLoading(true)
    void getDogs().then(dogs => { if (active) setSiblings(dogs.filter(d => d.id !== dog.id && d.litterId === dog.litterId && isCurrentOwner(d, user!.uid) && d.status !== 'transferred' && d.status !== 'restricted')) }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load littermates') }).finally(() => { if (active) setSiblingsLoading(false) })
    return () => { active = false }
  }, [dog.id, dog.litterId, user?.uid, editable, group, refresh])
  useEffect(() => {
    if (!editable || dog.tenantId !== user?.uid || dog.depositStatus !== 'received') return
    let active = true
    setBuyerReady(false)
    void managePrivateDogAccess(dog.id, 'get').then(grant => { if (active) { setGrantedEmail(grant?.buyerEmail || ''); if (grant?.buyerEmail) setBuyerEmail(grant.buyerEmail); setBuyerReady(true) } }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load buyer access') })
    return () => { active = false }
  }, [dog.id, dog.tenantId, dog.depositStatus, user?.uid, editable, refresh])
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
  function resetComposer() { setEditing(null); setText(''); setSelectedMedia([]); setSelectedDogs([dog.id]); setGroup(false); setShowLibrary(false); setAudience('internal'); changed() }
  function startEdit(update: PuppyUpdate) {
    setEditing(update); setText(update.text); setDate(update.date); setAudience(update.audience); setSelectedMedia(update.media.map(m => m.id)); setGroup(false); setShowLibrary(false); changed()
    composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    document.getElementById('puppy-update-text')?.focus({ preventScroll: true })
  }
  const editCallback = useRef(startEdit)
  editCallback.current = startEdit
  useEffect(() => { onEditReady?.(update => editCallback.current(update)) }, [onEditReady])
  async function toggleSharing() {
    if (!story || sharingLock.current) return
    sharingLock.current = true
    const previous = story.publicEnabled
    setStory({ ...story, publicEnabled: !previous }); setSharingBusy(true); setSharingMessage('Saving…'); setError('')
    try { await puppyUpdates({ action: 'settings', dogId: dog.id, publicEnabled: !previous }); setSharingMessage('Saved') }
    catch (e) { setStory(current => current ? { ...current, publicEnabled: previous } : current); setSharingMessage('Not saved'); setError(e instanceof Error ? e.message : 'Please retry') }
    finally { sharingLock.current = false; setSharingBusy(false) }
  }
  const availableMedia = [...gallery, ...(editing?.media || []).filter(m => !gallery.some(g => g.id === m.id))]
  return <section className="card" aria-label="Share puppy updates" style={{ padding: 18, marginBottom: 24 }}>
    <h3 style={{ margin: '0 0 8px' }}>Timeline updates</h3>
    <p style={{ fontSize: 13, color: 'var(--mid)' }}>Write a note or share photos and videos. Choose who can see each update; your puppy’s QR link stays the same.</p>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
      <Link className="btn btn-secondary btn-sm" to={puppyPath(dog.passportId)} target="_blank" rel="noreferrer">Preview QR profile</Link>
      <button className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard.writeText(puppyShareUrl(dog.passportId)).then(() => setMessage('Permanent puppy link copied')).catch(() => setError('Could not copy. Open the QR profile and copy its address.')) }}>Copy permanent link</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRefresh(v => v + 1)}>Refresh</button>
    </div>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}{message && <p role="status" style={{ color: 'var(--brand-600)' }}>{message}</p>}
    {!ready && !error && <div className="spinner" />}
    {editable && story && <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
        <button type="button" role="switch" aria-checked={story.publicEnabled} aria-label="Public QR updates" disabled={sharingBusy || busy} onClick={() => void toggleSharing()} style={{ width: 52, height: 30, padding: 3, border: 0, borderRadius: 20, background: story.publicEnabled ? 'var(--brand-600)' : '#777', cursor: 'pointer' }}><span style={{ display: 'block', width: 24, height: 24, borderRadius: '50%', background: '#fff', transform: story.publicEnabled ? 'translateX(22px)' : 'translateX(0)', transition: 'transform .15s ease' }} /></button>
        <span>Public QR updates <strong>{story.publicEnabled ? 'On' : 'Off'}</strong></span><span role="status" style={{ fontSize: 12 }}>{sharingMessage}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--mid)' }}>Only updates marked Public appear to visitors. Public story sharing pauses when ownership changes; the new owner decides what to publish.</p>
      {dog.tenantId === user?.uid && dog.depositStatus === 'received' && <fieldset disabled={busy || !buyerReady} style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 10, marginBottom: 16 }}><legend>Deposited buyer access</legend><p style={{ fontSize: 12 }}>The buyer signs in with this verified email to view private updates on the same QR profile. This does not transfer ownership.</p><label className="form-label" htmlFor="puppy-buyer-email">Buyer email</label><input id="puppy-buyer-email" className="form-input" type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} />{grantedEmail && <p style={{ fontSize: 12 }}>Access active for {grantedEmail}</p>}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><button className="btn btn-secondary btn-sm" disabled={!buyerEmail.trim()} onClick={() => void run(async () => { if (grantedEmail && grantedEmail.toLowerCase() !== buyerEmail.trim().toLowerCase() && !window.confirm('Replace the current buyer’s private access? Their access will stop.')) return; await managePrivateDogAccess(dog.id, 'grant', buyerEmail) }, 'Buyer access saved. Send them the permanent puppy link.')}>{grantedEmail ? 'Update buyer access' : 'Grant buyer access'}</button>{grantedEmail && <button className="btn btn-ghost btn-sm" onClick={() => void run(() => managePrivateDogAccess(dog.id, 'revoke'), 'Buyer private access revoked')}>Revoke access</button>}</div></fieldset>}
      <fieldset ref={composer} disabled={busy || !ready || sharingBusy} style={{ border: 0, padding: 0, margin: '16px 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: 10 }}>{editing ? 'Edit update' : 'Add an update'}</legend>
        <button type="button" className="btn btn-secondary" style={{ display: 'block', marginBottom: 16 }} onClick={() => fileInput.current?.click()}>＋ Add photos / videos</button>
        <label className="form-label" htmlFor="puppy-update-date" style={{ display: 'block' }}>Update date</label><input id="puppy-update-date" className="form-input" type="date" value={date} onChange={e => { setDate(e.target.value); changed() }} style={{ display: 'block', maxWidth: 200, marginBottom: 14 }} />
        <label className="form-label" htmlFor="puppy-update-text">What’s new?</label><textarea id="puppy-update-text" className="form-textarea" maxLength={3000} value={text} placeholder="Week 5 — exploring the garden together…" onChange={e => { setText(e.target.value); changed() }} style={{ minHeight: 80, width: '100%' }} />
        <label className="form-label" htmlFor="puppy-update-audience" style={{ marginTop: 12 }}>Who can see this update?</label><select id="puppy-update-audience" className="form-select" value={audience} onChange={e => { setAudience(e.target.value as UpdateAudience); changed() }}>{Object.entries(AUDIENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {audience === 'public' && !story.publicEnabled && <p style={{ fontSize: 12, color: 'var(--warning)' }}>Public sharing is off. Enable it above before visitors can see public updates.</p>}
        {audience === 'buyer' && <p style={{ fontSize: 12, color: 'var(--mid)' }}>Private updates require buyer access after the deposit is marked Received. Following alone does not unlock them.</p>}
        {!editing && dog.litterId && <div style={{ margin: '16px 0' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={group} onChange={e => { setGroup(e.target.checked); if (!e.target.checked) setSelectedDogs([dog.id]); changed() }} /> Also post to other puppies in this litter</label>
          {group && <div style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 10 }}>
            {siblingsLoading && <p role="status">Loading littermates…</p>}
            <p style={{ fontSize: 13 }}>Always includes {dog.name}. Choose other puppies shown in these photos.</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSelectedDogs(selectedDogs.length === Math.min(siblings.length + 1, 12) ? [dog.id] : [dog.id, ...siblings.slice(0, 11).map(d => d.id)]); changed() }}>{selectedDogs.length === Math.min(siblings.length + 1, 12) ? 'Clear others' : 'Select all (up to 12)'}</button>
            <span style={{ fontSize: 13 }}> {selectedDogs.length} puppies selected</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>{siblings.map(sibling => <label key={sibling.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 24, background: selectedDogs.includes(sibling.id) ? 'var(--sand)' : 'transparent' }}><input type="checkbox" checked={selectedDogs.includes(sibling.id)} disabled={!selectedDogs.includes(sibling.id) && selectedDogs.length >= 12} onChange={e => { setSelectedDogs(ids => e.target.checked ? [...ids, sibling.id] : ids.filter(id => id !== sibling.id)); changed() }} />{sibling.name}</label>)}</div>
          </div>}
        </div>}
        {editing && <p style={{ fontSize: 12 }}>Changes apply to this puppy’s update only. Other puppies’ copies stay unchanged.</p>}
        <input ref={fileInput} aria-label="Upload update photos and videos" type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" style={{ display: 'none' }} onChange={e => { void upload(e.target.files); e.target.value = ''; changed() }} />
        <p style={{ fontSize: 12, color: 'var(--mid)' }}>Up to 12 photos/videos. Videos up to 20 MB. Removing an item here does not delete it from other updates.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>{selectedMedia.map(id => {
          const media = availableMedia.find(m => m.id === id)
          return <div key={id} style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 10 }}>
            {media ? (media.kind === 'photo' ? <img src={media.url} alt="Selected update photo" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 6 }} /> : <video src={media.url} controls preload="metadata" style={{ width: '100%', height: 100 }} />) : <span>Loading media…</span>}
            <button type="button" className="btn btn-ghost btn-sm" aria-label={'Remove selected ' + (media?.kind || 'media') + ' ' + (selectedMedia.indexOf(id) + 1)} onClick={() => { setSelectedMedia(ids => ids.filter(item => item !== id)); changed() }}>× Remove</button>
          </div>
        })}</div>
        {<><button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowLibrary(value => !value)}>{showLibrary ? 'Hide uploaded media' : 'Choose from uploaded media'}</button>
          {showLibrary && galleryLoading && <p role="status">Loading uploaded media…</p>}
          {showLibrary && !galleryLoading && !gallery.length && <p>No uploaded media yet. Use Add photos / videos above.</p>}
          {showLibrary && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, margin: '12px 0' }}>{gallery.map(media => <button type="button" key={media.id} aria-label={'Select ' + media.kind + ' ' + media.id} aria-pressed={selectedMedia.includes(media.id)} disabled={!selectedMedia.includes(media.id) && selectedMedia.length >= 12} style={{ padding: 6, border: selectedMedia.includes(media.id) ? '2px solid var(--brand-600)' : '1px solid var(--border)', borderRadius: 10, background: 'transparent' }} onClick={() => { setSelectedMedia(ids => ids.includes(media.id) ? ids.filter(id => id !== media.id) : [...ids, media.id]); changed() }}>
            {media.kind === 'photo' ? <img src={media.url} alt="Uploaded puppy photo" style={{ width: '100%', height: 90, objectFit: 'cover' }} /> : <video src={media.url} preload="metadata" muted style={{ width: '100%', height: 90 }} />}
            <span>{selectedMedia.includes(media.id) ? '✓ Selected' : '＋ Select'}</span>
          </button>)}</div>}
        </>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!text.trim() || selectedMedia.length > 12 || selectedDogs.length > 12} onClick={() => void run(async () => { await puppyUpdates(editing ? { action: 'edit', dogId: dog.id, updateId: editing.id, text, date, audience, mediaIds: selectedMedia } : { action: 'create', dogIds: [dog.id, ...selectedDogs.filter(id => id !== dog.id)], requestId, text, date, audience, mediaIds: selectedMedia }); resetComposer() }, editing ? 'Changes saved' : 'Update saved')}>{busy ? 'Saving…' : editing ? 'Save changes' : audience === 'internal' ? 'Save private update' : 'Publish update'}</button>
          {(editing || text || selectedMedia.length > 0) && <button type="button" className="btn btn-secondary" onClick={resetComposer}>Cancel</button>}
        </div>
      </fieldset>
    </>}
    {story && !onUpdates && <PuppyUpdateFeed edit={editable ? startEdit : undefined} updates={story.updates} busy={busy} manage={editable ? (id, action, visibility) => void run(() => puppyUpdates({ action, dogId: dog.id, updateId: id, audience: visibility }), 'Update changed') : undefined} />}
    {story?.nextCursor && <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const data = await puppyUpdates({ action: 'view', dogId: dog.id, cursor: story.nextCursor }); setStory(previous => { const next = previous ? { ...data, updates: [...previous.updates, ...data.updates] } : data; return next }); onUpdates?.([...story.updates, ...data.updates]) } catch (e) { setError(e instanceof Error ? e.message : 'Please retry') } finally { setBusy(false) } }}>Load older updates</button>}
  </section>
}
