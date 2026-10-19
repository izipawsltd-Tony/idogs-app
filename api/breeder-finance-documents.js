import { FieldValue } from 'firebase-admin/firestore'
import { verifyBreeder, cleanText, cleanEmail, cleanMoneyCents } from './_lib/breeder-finance-auth.js'

const TYPES = new Set(['invoice', 'receipt', 'refund'])
const PREFIX = { invoice: 'INV', receipt: 'REC', refund: 'RFD' }

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

function docYear(issueDate) {
  const y = Number(String(issueDate || '').slice(0, 4))
  return y >= 2020 && y <= 2100 ? y : new Date().getFullYear()
}

function safeBuyer(raw = {}) {
  return {
    name: cleanText(raw.name, 120),
    email: cleanEmail(raw.email),
    phone: cleanText(raw.phone, 40),
    address: cleanText(raw.address, 300),
  }
}

function safeSeller(raw = {}, profile = {}, email = '') {
  const firstLast = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
  return {
    businessName: cleanText(raw.businessName, 160) || cleanText(profile.businessName, 160) || cleanText(profile.kennelName, 160) || firstLast || 'Breeder',
    contactName: cleanText(raw.contactName, 120) || firstLast,
    email: cleanEmail(raw.email) || cleanEmail(profile.email) || cleanEmail(email),
    phone: cleanText(raw.phone, 40) || cleanText(profile.phone, 40),
    address: cleanText(raw.address, 300) || cleanText(profile.address, 300),
    state: cleanText(raw.state, 20) || cleanText(profile.state, 20),
    postcode: cleanText(raw.postcode, 10) || cleanText(profile.postcode, 10),
    abn: cleanText(raw.abn, 30) || cleanText(profile.abn, 30),
    breederId: cleanText(raw.breederId, 80) || cleanText(profile.breederIdValue, 80),
    gstRegistered: raw.gstRegistered === true,
    bankAccountName: cleanText(raw.bankAccountName, 120) || cleanText(profile.bankAccountName, 120),
    bankBsb: cleanText(raw.bankBsb, 20) || cleanText(profile.bankBsb, 20),
    bankAccountNumber: cleanText(raw.bankAccountNumber, 40) || cleanText(profile.bankAccountNumber, 40),
  }
}

function toIso(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  return null
}

function serialize(doc) {
  const d = doc.data()
  return {
    id: doc.id,
    ...d,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    emailedAt: toIso(d.emailedAt),
  }
}

export default async function handler(req, res) {
  const auth = await verifyBreeder(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  const { uid, email, profile, db } = auth

  if (req.method === 'GET') {
    try {
      const snap = await db.collection('financeDocuments').where('tenantId', '==', uid).get()
      const rows = snap.docs.map(serialize).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      return res.status(200).json({ documents: rows })
    } catch (error) {
      console.error('finance-documents list failed', { code: error?.code || 'unknown' })
      return res.status(500).json({ error: 'Failed to load finance documents' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = bodyOf(req)
  const type = TYPES.has(body.type) ? body.type : ''
  if (!type) return res.status(400).json({ error: 'Invalid document type' })

  const dogId = cleanText(body.dogId, 160)
  if (!dogId) return res.status(400).json({ error: 'Dog is required' })

  try {
    const dogSnap = await db.collection('dogs').doc(dogId).get()
    if (!dogSnap.exists) return res.status(404).json({ error: 'Dog not found' })
    const dog = dogSnap.data() || {}
    if (dog.tenantId !== uid) return res.status(403).json({ error: 'This dog is not part of your breeder records' })

    const buyer = safeBuyer(body.buyer)
    if (!buyer.name) return res.status(400).json({ error: 'Buyer name is required' })
    const seller = safeSeller(body.seller, profile, email)

    const issueDate = cleanText(body.issueDate, 10) || new Date().toISOString().slice(0, 10)
    const dueDate = cleanText(body.dueDate, 10)
    const salePriceCents = cleanMoneyCents(body.salePriceCents)
    const depositPaidCents = Math.min(cleanMoneyCents(body.depositPaidCents), salePriceCents)
    const amountPaidCents = cleanMoneyCents(body.amountPaidCents)
    const refundAmountCents = cleanMoneyCents(body.refundAmountCents)
    const gstCents = seller.gstRegistered ? Math.round(salePriceCents / 11) : 0

    if (type === 'invoice' && salePriceCents <= 0) return res.status(400).json({ error: 'Invoice total must be greater than zero' })
    if (type === 'receipt' && amountPaidCents <= 0) return res.status(400).json({ error: 'Receipt amount must be greater than zero' })
    if (type === 'refund' && refundAmountCents <= 0) return res.status(400).json({ error: 'Refund amount must be greater than zero' })

    const counterRef = db.collection('financeCounters').doc(uid)
    const documentRef = db.collection('financeDocuments').doc()
    const year = docYear(issueDate)

    let documentNumber = ''
    await db.runTransaction(async tx => {
      const counterSnap = await tx.get(counterRef)
      const current = counterSnap.exists ? (counterSnap.data() || {}) : {}
      const field = type + 'Seq'
      const next = Number(current[field] || 0) + 1
      documentNumber = `${PREFIX[type]}-${year}-${String(next).padStart(5, '0')}`

      tx.set(counterRef, { [field]: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      tx.set(documentRef, {
        tenantId: uid,
        type,
        documentNumber,
        issueDate,
        dueDate: type === 'invoice' ? dueDate : '',
        seller,
        buyer,
        dog: {
          id: dogSnap.id,
          name: cleanText(dog.name, 120),
          breed: cleanText(dog.breed, 120),
          sex: cleanText(dog.sex, 20),
          dateOfBirth: cleanText(dog.dateOfBirth, 20),
          colour: cleanText(dog.colour, 80),
          microchip: cleanText(dog.microchip, 80),
          registration: cleanText(dog.ankc, 80),
        },
        salePriceCents,
        gstCents,
        depositPaidCents,
        balanceDueCents: Math.max(0, salePriceCents - depositPaidCents),
        amountPaidCents,
        refundAmountCents,
        paymentMethod: cleanText(body.paymentMethod, 80),
        paymentReference: cleanText(body.paymentReference, 120),
        originalDocumentNumber: cleanText(body.originalDocumentNumber, 80),
        refundReason: cleanText(body.refundReason, 500),
        notes: cleanText(body.notes, 1500),
        status: type === 'invoice' ? 'issued' : type === 'receipt' ? 'paid' : 'refunded',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    const created = await documentRef.get()
    return res.status(201).json({ document: serialize(created) })
  } catch (error) {
    console.error('finance-documents create failed', { code: error?.code || 'unknown' })
    return res.status(500).json({ error: 'Failed to create finance document' })
  }
}
