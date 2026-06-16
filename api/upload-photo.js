// api/upload-photo.js — upload dog profile photo via Firebase Admin SDK
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'

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
    const filePath = `dogs/${userId}/${dogId}/profile.${ext}`

    const bucket = getStorage().bucket('idogs-app.firebasestorage.app')
    const file = bucket.file(filePath)
    const buffer = Buffer.from(base64, 'base64')

    await file.save(buffer, {
      metadata: { contentType: mediaType || 'image/jpeg' },
    })
    await file.makePublic()

    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`

    // Update dog profile in Firestore
    const db = getFirestore()
    await db.collection('dogs').doc(dogId).update({
      profilePhoto: fileUrl,
      updatedAt: new Date(),
    })

    return res.status(200).json({ success: true, fileUrl })
  } catch (err) {
    console.error('Photo upload error:', err)
    return res.status(500).json({ error: 'Upload failed', message: String(err) })
  }
}
