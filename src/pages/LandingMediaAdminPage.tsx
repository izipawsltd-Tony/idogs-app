import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { isSuperAdminEmail } from '../lib/superAdmin'
import {
  SLOT_IDS, fetchLandingMediaState, uploadLandingMediaDirect, validateFileForKind,
  publishLandingMediaDraft, removePublishedLandingMedia, cancelLandingMediaDraft,
  type LandingSlotId, type LandingMediaSlotState,
} from '../lib/landingMedia'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const SLOT_LABELS: Record<LandingSlotId, { title: string; hint: string }> = {
  hero: { title: 'Hero', hint: 'Main visual at the top of the landing page.' },
  'dog-profile': { title: 'Dog Profile & Records', hint: 'First "quick look" screenshot (desktop-framed).' },
  'puppy-showcase': { title: 'Puppy Showcase', hint: 'Second "quick look" screenshot (mobile-framed).' },
  'digital-passport': { title: 'Digital Passport / QR', hint: 'Third "quick look" screenshot (mobile-framed).' },
}

type Busy = 'uploading' | 'publishing' | 'removing' | 'cancelling' | null

interface SlotUi extends LandingMediaSlotState {
  busy: Busy
  uploadProgress: number
  error: string | null
}

const EMPTY_SLOT: SlotUi = { published: null, draft: null, busy: null, uploadProgress: 0, error: null }

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.ceil(n / 1024)} KB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default function LandingMediaAdminPage({ toast }: Props) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<Record<LandingSlotId, SlotUi>>(() => {
    const initial = {} as Record<LandingSlotId, SlotUi>
    SLOT_IDS.forEach(id => { initial[id] = { ...EMPTY_SLOT } })
    return initial
  })
  const fileInputRefs = useRef<Record<LandingSlotId, HTMLInputElement | null>>({} as Record<LandingSlotId, HTMLInputElement | null>)

  const isAdmin = isSuperAdminEmail(user?.email)

  useEffect(() => {
    if (isAdmin) loadState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  async function loadState() {
    setLoading(true)
    try {
      const state = await fetchLandingMediaState()
      setSlots(prev => {
        const next = { ...prev }
        SLOT_IDS.forEach(id => {
          next[id] = { ...EMPTY_SLOT, published: state[id]?.published ?? null, draft: state[id]?.draft ?? null }
        })
        return next
      })
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Failed to load landing media', 'error')
    } finally {
      setLoading(false)
    }
  }

  function patchSlot(slotId: LandingSlotId, patch: Partial<SlotUi>) {
    setSlots(prev => ({ ...prev, [slotId]: { ...prev[slotId], ...patch } }))
  }

  async function handleFileSelected(slotId: LandingSlotId, file: File) {
    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    const validationError = validateFileForKind(file, kind)
    if (validationError) {
      patchSlot(slotId, { error: validationError })
      return
    }
    patchSlot(slotId, { busy: 'uploading', uploadProgress: 0, error: null })
    try {
      const draft = await uploadLandingMediaDirect(slotId, kind, file, percent => {
        patchSlot(slotId, { uploadProgress: percent })
      })
      patchSlot(slotId, { draft, busy: null, uploadProgress: 0 })
      toast(`${SLOT_LABELS[slotId].title}: new draft uploaded — review and Publish to make it live`)
    } catch (err) {
      patchSlot(slotId, { busy: null, uploadProgress: 0, error: err instanceof Error && err.message ? err.message : 'Upload failed' })
    }
  }

  async function handlePublish(slotId: LandingSlotId) {
    patchSlot(slotId, { busy: 'publishing', error: null })
    try {
      await publishLandingMediaDraft(slotId)
      await loadState()
      toast(`${SLOT_LABELS[slotId].title}: published — now live on the landing page`)
    } catch (err) {
      patchSlot(slotId, { busy: null, error: err instanceof Error && err.message ? err.message : 'Publish failed' })
    }
  }

  async function handleCancelDraft(slotId: LandingSlotId) {
    patchSlot(slotId, { busy: 'cancelling', error: null })
    try {
      await cancelLandingMediaDraft(slotId)
      patchSlot(slotId, { draft: null, busy: null })
      toast('Draft discarded')
    } catch (err) {
      patchSlot(slotId, { busy: null, error: err instanceof Error && err.message ? err.message : 'Failed to discard draft' })
    }
  }

  async function handleRemove(slotId: LandingSlotId) {
    if (!window.confirm(`Remove the published ${SLOT_LABELS[slotId].title} media? The landing page will show its default placeholder until you publish something new. This cannot be undone.`)) return
    patchSlot(slotId, { busy: 'removing', error: null })
    try {
      await removePublishedLandingMedia(slotId)
      patchSlot(slotId, { published: null, busy: null })
      toast(`${SLOT_LABELS[slotId].title}: removed — showing default placeholder`)
    } catch (err) {
      patchSlot(slotId, { busy: null, error: err instanceof Error && err.message ? err.message : 'Failed to remove' })
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Admin only</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--dark)', margin: 0 }}>Landing Page Media</h1>
        <p style={{ fontSize: 14, color: 'var(--mid)', marginTop: 4 }}>
          Manage the images/videos shown on the public landing page. Changes only go live after you press <strong>Publish</strong>.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {SLOT_IDS.map(slotId => (
            <SlotCard
              key={slotId}
              slotId={slotId}
              ui={slots[slotId]}
              onFileSelected={file => handleFileSelected(slotId, file)}
              onPublish={() => handlePublish(slotId)}
              onCancelDraft={() => handleCancelDraft(slotId)}
              onRemove={() => handleRemove(slotId)}
              onPickFile={() => fileInputRefs.current[slotId]?.click()}
              inputRef={el => { fileInputRefs.current[slotId] = el }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SlotCard({ slotId, ui, onFileSelected, onPublish, onCancelDraft, onRemove, onPickFile, inputRef }: {
  slotId: LandingSlotId
  ui: SlotUi
  onFileSelected: (file: File) => void
  onPublish: () => void
  onCancelDraft: () => void
  onRemove: () => void
  onPickFile: () => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const { title, hint } = SLOT_LABELS[slotId]
  const busy = ui.busy !== null
  const isUploading = ui.busy === 'uploading'

  return (
    <div className="card card-shadow" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--dark)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 2 }}>{hint}</div>
      </div>

      {/* ── Published preview ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--sand, #F5F0E8)' }}>
        {ui.published ? (
          ui.published.kind === 'video' ? (
            <video src={ui.published.url} muted loop playsInline autoPlay style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
          ) : (
            <img src={ui.published.url} alt="" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
          )
        ) : (
          <div style={{ width: '100%', aspectRatio: '16/10', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--light)', textAlign: 'center', padding: 12 }}>
            No published media — showing default placeholder
          </div>
        )}
      </div>
      {ui.published && (
        <div style={{ fontSize: 11, color: 'var(--mid)', lineHeight: 1.5 }}>
          <strong>Published</strong> · {ui.published.filename || '(unnamed)'} · {ui.published.contentType} · {formatBytes(ui.published.sizeBytes)}<br />
          Updated {formatDate(ui.published.publishedAt)}
        </div>
      )}

      {/* ── Draft (unpublished) ── */}
      {ui.draft && (
        <div style={{ border: '1px dashed var(--gold-500, #D4AF37)', borderRadius: 10, padding: 8, background: 'var(--gold-50, #FAF7EB)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-500, #D4AF37)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Draft — not yet public</div>
          {ui.draft.kind === 'video' ? (
            <video src={ui.draft.previewUrl} muted loop playsInline autoPlay style={{ width: '100%', borderRadius: 8, aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
          ) : (
            <img src={ui.draft.previewUrl} alt="" style={{ width: '100%', borderRadius: 8, aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
          )}
          <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 6, lineHeight: 1.5 }}>
            {ui.draft.filename || '(unnamed)'} · {ui.draft.contentType} · {formatBytes(ui.draft.sizeBytes)}<br />
            Uploaded {formatDate(ui.draft.uploadedAt)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onPublish} style={{ flex: 1 }}>
              {ui.busy === 'publishing' ? <span className="spinner" /> : 'Publish'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onCancelDraft} style={{ flex: 1 }}>
              {ui.busy === 'cancelling' ? <span className="spinner" /> : 'Cancel draft'}
            </button>
          </div>
        </div>
      )}

      {/* ── Upload progress ── */}
      {isUploading && (
        <div>
          <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${ui.uploadProgress}%`, background: 'var(--brand-600)', transition: 'width 0.15s' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>Uploading… {ui.uploadProgress}%</div>
        </div>
      )}

      {/* ── Inline error ── */}
      {ui.error && (
        <div style={{ fontSize: 12, color: 'var(--danger, #C0392B)', background: 'rgba(192,57,43,0.08)', borderRadius: 8, padding: '8px 10px' }}>
          {ui.error}
        </div>
      )}

      {/* ── Actions ── */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFileSelected(f)
          e.target.value = ''
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onPickFile} style={{ flex: 1 }}>
          {isUploading ? <span className="spinner" /> : (ui.draft || ui.published) ? 'Upload / Replace' : 'Upload'}
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy || !ui.published} onClick={onRemove}>
          {ui.busy === 'removing' ? <span className="spinner" /> : 'Remove'}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--light)' }}>
        Images: JPG/PNG/WebP, max 5MB. Videos: MP4/WebM, max 20MB.
      </div>
    </div>
  )
}
