// src/lib/landingMedia.ts — client helpers for the self-managed Landing
// Page Media feature. The public landing read intentionally keeps Firebase
// out of the initial landing bundle: Firestore is loaded dynamically only
// after the Hero/LCP window, while admin operations load auth on demand.

export const SLOT_IDS = ['hero', 'dog-profile', 'puppy-showcase', 'digital-passport'] as const
export type LandingSlotId = typeof SLOT_IDS[number]
export type LandingMediaKind = 'image' | 'video'

export const MAX_LANDING_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_LANDING_VIDEO_BYTES = 20 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm'])

export interface PublishedLandingMedia {
  slotId: string
  kind: LandingMediaKind
  url: string
  path: string
  contentType: string
  filename: string
  sizeBytes: number
  publishedAt: string
  publishedBy: string
}

export interface DraftLandingMedia {
  slotId: string
  kind: LandingMediaKind
  path: string
  contentType: string
  filename: string
  sizeBytes: number
  mediaId: string
  uploadedAt: string
  uploadedBy: string
  previewUrl: string
}

export interface LandingMediaSlotState {
  published: PublishedLandingMedia | null
  draft: DraftLandingMedia | null
}

export function validateFileForKind(file: File, kind: LandingMediaKind): string | null {
  const allowed = kind === 'image' ? ALLOWED_IMAGE_TYPES : ALLOWED_VIDEO_TYPES
  if (!allowed.has(file.type)) {
    return kind === 'image'
      ? 'Please choose a JPG, PNG, or WebP image'
      : 'Please choose an MP4 or WebM video'
  }
  const maxBytes = kind === 'image' ? MAX_LANDING_IMAGE_BYTES : MAX_LANDING_VIDEO_BYTES
  if (file.size > maxBytes) {
    return `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit for ${kind === 'image' ? 'images' : 'videos'}`
  }
  return null
}

async function waitUntilAfterLandingLcpWindow(): Promise<void> {
  if (typeof window === 'undefined' || window.location.pathname !== '/') return
  const remaining = 3000 - performance.now()
  if (remaining <= 0) return
  await new Promise<void>(resolve => window.setTimeout(resolve, remaining))
}

// Public read — no authentication required. Keep the below-the-fold media
// configuration off the critical Hero path: the marketing placeholders are
// complete fallbacks, so waiting until after the LCP window is safe and avoids
// pulling Firestore into the initial mobile load.
export async function fetchPublishedLandingMedia(slotId: LandingSlotId): Promise<PublishedLandingMedia | null> {
  try {
    await waitUntilAfterLandingLcpWindow()
    const [{ db }, firestore] = await Promise.all([
      import('./firebase'),
      import('firebase/firestore'),
    ])
    const snap = await firestore.getDoc(firestore.doc(db, 'landingMediaPublished', slotId))
    if (!snap.exists()) return null
    return snap.data() as PublishedLandingMedia
  } catch {
    return null
  }
}

async function getAuth() {
  const { auth } = await import('./firebase')
  return auth
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const auth = await getAuth()
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body ?? {}),
  })
}

export async function fetchLandingMediaState(): Promise<Record<LandingSlotId, LandingMediaSlotState>> {
  const res = await authedFetch('/api/get-landing-media-state', {})
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Failed to load landing media state (${res.status})`)
  }
  const { slots } = await res.json()
  return slots
}

export async function uploadLandingMediaDirect(
  slotId: LandingSlotId,
  kind: LandingMediaKind,
  file: File,
  onProgress?: (percent: number) => void
): Promise<DraftLandingMedia> {
  const auth = await getAuth()
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()

  const requestRes = await fetch('/api/request-landing-media-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ slotId, kind, contentType: file.type, sizeBytes: file.size }),
  })
  if (!requestRes.ok) {
    const err = await requestRes.json().catch(() => ({}))
    throw new Error(err.error || `Upload request failed (${requestRes.status})`)
  }
  const { mediaId, uploadUrl, requiredHeaders } = await requestRes.json()

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    for (const [key, value] of Object.entries(requiredHeaders || {})) {
      xhr.setRequestHeader(key, value as string)
    }
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status}) — please try again`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — please check your connection and try again'))
    xhr.send(file)
  })

  const confirmRes = await fetch('/api/confirm-landing-media-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ mediaId, filename: file.name }),
  })
  if (!confirmRes.ok) {
    const err = await confirmRes.json().catch(() => ({}))
    throw new Error(err.error || `Upload confirmation failed (${confirmRes.status})`)
  }
  const { draft } = await confirmRes.json()
  return draft
}

async function manage(action: 'publish' | 'remove' | 'cancel-draft', slotId: LandingSlotId): Promise<void> {
  const res = await authedFetch('/api/manage-landing-media', { action, slotId })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Action failed (${res.status})`)
  }
}

export const publishLandingMediaDraft = (slotId: LandingSlotId) => manage('publish', slotId)
export const removePublishedLandingMedia = (slotId: LandingSlotId) => manage('remove', slotId)
export const cancelLandingMediaDraft = (slotId: LandingSlotId) => manage('cancel-draft', slotId)
