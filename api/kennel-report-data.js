import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { computeEffectivePlan } from './_lib/entitlements.js'
import { validateFacility, validateMovement, validateDailyLog } from './_lib/kennel-input.js'

if (!getApps().length) initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
}) })
const db = getFirestore()

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!token || token === req.headers.authorization) return res.status(401).json({ error: 'Missing token' })
    const { uid } = await getAuth().verifyIdToken(token)
    const profile = (await db.collection('users').doc(uid).get()).data()
    if (computeEffectivePlan(profile) !== 'plus') return res.status(403).json({ error: 'Plus required' })
    const facilityRef = db.collection('kennelFacilities').doc(uid)
    if (req.method === 'GET') {
      const [facility, movements, logs] = await Promise.all([
        facilityRef.get(), db.collection('kennelMovements').where('tenantId', '==', uid).limit(2001).get(),
        db.collection('kennelDailyLogs').where('tenantId', '==', uid).limit(2001).get(),
      ])
      if (movements.size > 2000 || logs.size > 2000) return res.status(409).json({ error: 'Too many records for one report; contact support' })
      return res.status(200).json({ facility: facility.data() || null,
        movements: movements.docs.map(d => ({ id: d.id, ...d.data() })),
        dailyLogs: logs.docs.map(d => ({ id: d.id, ...d.data() })) })
    }
    const { action } = req.body || {}
    if (action === 'saveFacility') {
      const data = validateFacility(req.body.facility)
      await facilityRef.set({ ...data, tenantId: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return res.status(200).json({ ok: true })
    }
    if (action === 'addMovement') {
      const data = validateMovement(req.body.movement)
      const dog = await db.collection('dogs').doc(data.dogId).get()
      if (!dog.exists || dog.data().tenantId !== uid) return res.status(403).json({ error: 'Dog not in this breeder account' })
      await db.collection('kennelMovements').add({ ...data, tenantId: uid, recordedAt: FieldValue.serverTimestamp() })
      return res.status(200).json({ ok: true })
    }
    if (action === 'voidMovement') {
      const id = req.body.id
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(id)) return res.status(400).json({ error: 'Invalid ID' })
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : ''
      if (!reason) return res.status(400).json({ error: 'Reason required' })
      const ref = db.collection('kennelMovements').doc(id)
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().tenantId !== uid) throw new Error('Movement not found')
        if (snap.data().voidedAt) throw new Error('Already voided')
        tx.update(ref, { voidedAt: FieldValue.serverTimestamp(), voidReason: reason })
      })
      return res.status(200).json({ ok: true })
    }
    if (action === 'saveDailyLog') {
      const data = validateDailyLog(req.body.dailyLog)
      const ref = db.collection('kennelDailyLogs').doc(`${uid}_${data.date}`)
      await db.runTransaction(async tx => {
        const previous = await tx.get(ref)
        if (previous.exists) tx.set(ref.collection('revisions').doc(), {
          previous: previous.data(), replacedAt: FieldValue.serverTimestamp(), replacedBy: uid,
        })
        tx.set(ref, { ...data, tenantId: uid, updatedAt: FieldValue.serverTimestamp() })
      })
      return res.status(200).json({ ok: true })
    }
    return res.status(400).json({ error: 'Invalid action' })
  } catch (err) {
    if (err.message?.startsWith('Invalid')) return res.status(400).json({ error: err.message })
    if (typeof err.code === 'string' && err.code.startsWith('auth/')) return res.status(401).json({ error: 'Invalid token' })
    console.error('Kennel report data error', err)
    return res.status(500).json({ error: 'Request failed' })
  }
}
