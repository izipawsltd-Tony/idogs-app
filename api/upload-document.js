// api/upload-document.js — Vercel serverless
// Receives file as base64, uploads to Firebase Storage via Admin SDK

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'

// Init Firebase Admin (once)
if (!getApps().length) {
  // Firebase private key: replace escaped newlines and convert RSA → PKCS8 if needed
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || ''
  privateKey = privateKey.replace(/\\n/g, '\n')
  
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app',
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { base64, mediaType, dogId, tenantId, documentType, extractedData } = req.body

  if (!base64 || !dogId || !tenantId) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const ext = mediaType === 'application/pdf' ? 'pdf' : 'jpg'
    const fileName = `${documentType || 'document'}_${Date.now()}.${ext}`
    const filePath = `documents/${tenantId}/${dogId}/${fileName}`

    // Upload to Firebase Storage
    const bucket = getStorage().bucket('idogs-app.firebasestorage.app')
    const file = bucket.file(filePath)
    const buffer = Buffer.from(base64, 'base64')

    await file.save(buffer, {
      metadata: { contentType: mediaType || 'image/jpeg' },
    })

    // SECURITY FIX: files used to be made public via file.makePublic(),
    // which generates a permanent, unauthenticated, never-expiring public
    // URL (storage.googleapis.com/...) — anyone who ever obtained that
    // URL (browser history, a shared screenshot, server logs, etc.) could
    // view the document forever, with no way to revoke access short of
    // deleting the file. Documents often contain personal info (vet
    // records / pedigree certs print the owner's name/address). Files now
    // stay private; viewing requires /api/get-signed-url, which checks
    // the requester actually owns/breeds the dog and issues a short-lived
    // (10 min) signed URL instead.
    const fileUrl = null

    // Save metadata to Firestore
    const db = getFirestore()
    await db.collection('documents').add({
      dogId,
      tenantId,
      fileName,
      fileUrl,
      filePath,
      fileType: ext === 'pdf' ? 'pdf' : 'image',
      documentType: documentType || 'other',
      uploadedAt: new Date(),
      extractedData: extractedData || {},
    })

    return res.status(200).json({ success: true, filePath })
  } catch (err) {
    console.error('Upload error full:', JSON.stringify({
      message: err.message,
      code: err.code,
      stack: err.stack?.slice(0, 500),
    }))
    return res.status(500).json({ error: 'Upload failed', message: err.message, code: err.code })
  }
}
