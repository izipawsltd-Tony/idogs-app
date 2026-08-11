// api/get-landing-media-state.js — Super Admin -> Landing Page Media.
// Returns the current published + draft state for all four fixed
// landing-page slots in one call, so the admin UI can render its four
// cards without four separate round-trips. Admin-only: the draft's
// Storage object is PRIVATE, so this is also the only place a fresh,
// short-lived preview URL for an unpublished draft is ever minted.
//
// Published info is also available to the public via a direct client
// Firestore read of landingMediaPublished/{slotId} (see
// firestore.rules) — this endpoint additionally exposes it here purely
// so the admin page shows both draft and published state together
// without a second data source.
//
// GET /api/get-landing-media-state
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { slots: { [slotId]: { published: {...} | null, draft: {...} | null } } }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { logSanitizedError } from './_lib/http-helpers.js'
import { requireSuperAdmin } from './_lib/admin-access.js'
import {
  SLOT_IDS, LANDING_MEDIA_PUBLISHED_COLLECTION, LANDING_MEDIA_DRAFTS_COLLECTION,
  LANDING_DRAFT_PREVIEW_URL_TTL_MS,
} from './_lib/landing-media.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('get-landing-media-state', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  const admin = await requireSuperAdmin(req, getAuth)
  if (!admin) return res.status(403).json({ error: 'Not authorized' })

  const db = getFirestore()
  const bucket = getStorage().bucket(bucketName)

  try {
    const slots = {}
    await Promise.all(SLOT_IDS.map(async slotId => {
      const [publishedSnap, draftSnap] = await Promise.all([
        db.collection(LANDING_MEDIA_PUBLISHED_COLLECTION).doc(slotId).get(),
        db.collection(LANDING_MEDIA_DRAFTS_COLLECTION).doc(slotId).get(),
      ])

      const published = publishedSnap.exists ? publishedSnap.data() : null

      let draft = null
      if (draftSnap.exists) {
        const draftData = draftSnap.data()
        const file = bucket.file(draftData.path)
        const [exists] = await file.exists()
        if (exists) {
          const [previewUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + LANDING_DRAFT_PREVIEW_URL_TTL_MS })
          draft = { ...draftData, previewUrl }
        }
        // If the draft's Storage object is somehow missing (manual
        // console deletion, a very unlikely race), draft stays null
        // rather than showing a broken preview — same "never show a
        // broken/empty box" principle the public page follows.
      }

      slots[slotId] = { published, draft }
    }))

    return res.status(200).json({ slots })
  } catch (err) {
    logSanitizedError('get-landing-media-state', 'GET_STATE_FAILED')
    return res.status(500).json({ error: 'Could not load landing media state' })
  }
}

export default handler
