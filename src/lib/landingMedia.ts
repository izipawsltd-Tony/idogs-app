// src/lib/landingMedia.ts — client helpers for the self-managed Landing
// Page Media feature. Mirrors src/lib/db.ts's uploadShowcaseMediaDirect()
// architecture (request a signed URL -> PUT the bytes directly to
// Storage -> confirm), with two differences: uploads go through a raw
// XMLHttpRequest instead of fetch() so real upload-progress events are
// available (fetch has no upload-progress API), and the accepted
// file-type/size allowlist matches api/_lib/landing-media.js exactly
// (JPG/PNG/WebP images up to 5MB, MP4/WebM video up to 20MB — no HEIC,
// no MOV, no client-side compression: these are admin-supplied marketing
// assets, stored byte-for-byte as uploaded).

import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'

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

// Client-side pre-flight check only (fast, friendly error before any
// network call) — never the real security boundary. The server
// independently re-validates real content type (magic-byte sniff) and
// real size for every upload regardless of what this function decides.
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

// Public read — no authentication required. Firestore rules allow
// public `read` on landingMediaPublished/{slotId} specifically (see
// firestore.rules) and deny everything else in this feature outright.
// Returns null if the slot has never been published, or on ANY read
// failure — callers must treat null the same as "no custom media", never
// surface a broken/empty box.
export async function fetchPublishedLandingMedia(slotId: LandingSlotId): Promise<PublishedLandingMedia | null> {
  try {
    const snap = await getDoc(doc(db, 'landingMediaPublished', slotId))
    if (!snap.exists()) return null
    return snap.data() as PublishedLandingMedia
  } catch {
    return null
  }
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body ?? {}),
  })
}

// Admin-only — loads published+draft state for all four slots in one
// call. Throws on any non-2xx response (including 403 for a non-admin
// caller); the admin page's own gate should already prevent a non-admin
// from reaching this, but the server independently re-checks regardless.
export async function fetchLandingMediaState(): Promise<Record<LandingSlotId, LandingMediaSlotState>> {
  const res = await authedFetch('/api/get-landing-media-state', {})
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Failed to load landing media state (${res.status})`)
  }
  const { slots } = await res.json()
  return slots
}

// Uploads one file for a slot via the direct-to-Storage signed-URL flow,
// reporting real upload progress (0-100) via onProgress — uses
// XMLHttpRequest rather than fetch() specifically because fetch has no
// upload-progress event; everything else (request grant -> PUT bytes ->
// confirm) mirrors uploadShowcaseMediaDirect() in src/lib/db.ts.
export async function uploadLandingMediaDirect(
  slotId: LandingSlotId,
  kind: LandingMediaKind,
  file: File,
  onProgress?: (percent: number) => void
): Promise<DraftLandingMedia> {
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
        onProgress(Math.round((event.loaded / event.total) * 100))
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
