// api/manage-landing-media.js — Super Admin -> Landing Page Media.
// Consolidates the three post-upload lifecycle actions (Publish, Remove,
// Cancel draft) into one endpoint differentiated by `action` in the
// body — same consolidation convention api/upload.js already established
// for `?type=profile|note`, kept here to avoid growing the Vercel
// function count for three small, closely related operations.
//
// publish: promotes the slot's current DRAFT to PUBLISHED. This is the
//   ONLY action that makes a change public — see landingMediaPublished
//   below. The draft's private object is copied to a FRESH published
//   path and made public; the OLD published object (if any) is deleted
//   only AFTER the new one is confirmed live in Firestore, so a failed
//   publish never touches the currently-live public media ("Failed
//   upload/replace must preserve current published media").
//
// remove: immediately clears the slot's PUBLISHED media, reverting the
//   public landing page to its built-in fallback placeholder. Does not
//   touch the draft. The client is responsible for the "requires
//   confirmation" UX (a window.confirm before calling this — the same
//   convention every other destructive action in this codebase already
//   uses, e.g. LittersPage.tsx's PuppyMediaManager handleDelete).
//
// cancel-draft: discards the slot's current unpublished DRAFT (deletes
//   its private Storage object and Firestore doc), reverting the admin
//   UI back to showing only the published version (or the fallback, if
//   none). Never affects what the public sees.
//
// POST /api/manage-landing-media
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { action: 'publish' | 'remove' | 'cancel-draft', slotId }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { requireSuperAdmin } from './_lib/admin-access.js'
import {
  isValidSlotId, extensionForLandingUpload, publicStorageUrl,
  LANDING_MEDIA_PUBLISHED_COLLECTION, LANDING_MEDIA_DRAFTS_COLLECTION,
} from './_lib/landing-media.js'
import { randomUUID } from 'crypto'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function deleteObjectQuietly(bucket, path) {
  if (!path) return
  try {
    await bucket.file(path).delete()
  } catch {
    logSanitizedError('manage-landing-media (cleanup)', 'CLEANUP_FAILED')
  }
}

async function publish(db, bucket, bucketName, admin, slotId) {
  const draftRef = db.collection(LANDING_MEDIA_DRAFTS_COLLECTION).doc(slotId)
  const publishedRef = db.collection(LANDING_MEDIA_PUBLISHED_COLLECTION).doc(slotId)

  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) {
    return { status: 400, body: { error: 'No draft to publish for this slot', reason: 'NO_DRAFT' } }
  }
  const draft = draftSnap.data()

  const draftFile = bucket.file(draft.path)
  const [draftExists] = await draftFile.exists()
  if (!draftExists) {
    // Draft record exists but its object is gone (manual console
    // deletion, or an unlikely race) — never publish nothing. Current
    // published media (if any) is completely untouched.
    return { status: 400, body: { error: 'The draft file could not be found — please re-upload before publishing', reason: 'DRAFT_OBJECT_MISSING' } }
  }

  const extension = extensionForLandingUpload(draft.kind, draft.contentType) || 'bin'
  const publishedPath = `landing-media/${slotId}/published/${randomUUID()}.${extension}`
  const publishedFile = bucket.file(publishedPath)

  // Copy first, make public second — if EITHER step throws, nothing
  // below (Firestore write, old-object cleanup) ever runs, so the
  // currently-live published media is completely untouched on failure.
  await draftFile.copy(publishedFile)
  await publishedFile.makePublic()

  const publishedUrl = publicStorageUrl(bucketName, publishedPath)
  const previousPublishedSnap = await publishedRef.get()
  const previousPublishedPath = previousPublishedSnap.exists ? previousPublishedSnap.data()?.path : null

  const published = {
    slotId,
    kind: draft.kind,
    url: publishedUrl,
    path: publishedPath,
    contentType: draft.contentType,
    filename: draft.filename || '',
    sizeBytes: draft.sizeBytes,
    publishedAt: new Date().toISOString(),
    publishedBy: admin.uid,
  }

  const batch = db.batch()
  batch.set(publishedRef, published)
  batch.delete(draftRef)
  await batch.commit()

  // Only after the new published doc is safely committed: clean up the
  // draft's now-redundant private copy, and the PREVIOUS published
  // object (never before — see this file's own header comment).
  await deleteObjectQuietly(bucket, draft.path)
  if (previousPublishedPath && previousPublishedPath !== publishedPath) {
    await deleteObjectQuietly(bucket, previousPublishedPath)
  }

  return { status: 200, body: { success: true, slotId, published } }
}

async function remove(db, bucket, slotId) {
  const publishedRef = db.collection(LANDING_MEDIA_PUBLISHED_COLLECTION).doc(slotId)
  const publishedSnap = await publishedRef.get()
  if (!publishedSnap.exists) {
    return { status: 200, body: { success: true, slotId, alreadyRemoved: true } }
  }
  const previousPath = publishedSnap.data()?.path

  // Firestore delete is the actual "go live" moment for the public
  // reader — it happens first; the Storage object is only cleaned up
  // AFTER, since an orphaned-but-unreferenced object exposes nothing.
  await publishedRef.delete()
  await deleteObjectQuietly(bucket, previousPath)

  return { status: 200, body: { success: true, slotId } }
}

async function cancelDraft(db, bucket, slotId) {
  const draftRef = db.collection(LANDING_MEDIA_DRAFTS_COLLECTION).doc(slotId)
  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) {
    return { status: 200, body: { success: true, slotId, alreadyClear: true } }
  }
  const path = draftSnap.data()?.path

  await draftRef.delete()
  await deleteObjectQuietly(bucket, path)

  return { status: 200, body: { success: true, slotId } }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('manage-landing-media', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  const admin = await requireSuperAdmin(req, getAuth)
  if (!admin) return res.status(403).json({ error: 'Not authorized' })

  const { action, slotId } = req.body || {}
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'Invalid slotId' })
  if (action !== 'publish' && action !== 'remove' && action !== 'cancel-draft') {
    return res.status(400).json({ error: "action must be 'publish', 'remove', or 'cancel-draft'" })
  }

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  try {
    let result
    if (action === 'publish') result = await publish(db, bucket, bucketName, admin, slotId)
    else if (action === 'remove') result = await remove(db, bucket, slotId)
    else result = await cancelDraft(db, bucket, slotId)

    return res.status(result.status).json(result.body)
  } catch (err) {
    logSanitizedError(`manage-landing-media (${action})`, 'ACTION_FAILED')
    return res.status(500).json({ error: 'Action failed' })
  }
}

export default handler
