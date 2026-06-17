// api/upload-note-photo.js — upload a photo attached to an ActivityNote
// (timeline/story entry), via Firebase Admin SDK.
//
// Deliberately separate from upload-photo.js, which is hard-coded to
// write to dogs/{userId}/{dogId}/profile.{ext} and overwrite the dog's
// profilePhoto field on every call. Reusing that endpoint for note
// photos would silently overwrite the dog's profile picture every time
// someone added a photo to a story entry.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app',
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { base64, mediaType, dogId, userId } = req.body
  if (!base64 || !dogId || !userId) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg'
    // Unique filename per upload (timestamp + short random suffix) since
    // a dog can have many note photos over its lifetime, unlike the
    // single profile photo.
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filePath = `dogs/${userId}/${dogId}/notes/${uniqueName}`

    const bucket = getStorage().bucket('idogs-app.firebasestorage.app')
    const file = bucket.file(filePath)
    const buffer = Buffer.from(base64, 'base64')

    await file.save(buffer, {
      metadata: { contentType: mediaType || 'image/jpeg' },
    })
    await file.makePublic()

    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`

    return res.status(200).json({ success: true, fileUrl })
  } catch (err) {
    console.error('Note photo upload error:', err)
    return res.status(500).json({ error: 'Upload failed', message: String(err) })
  }
}
