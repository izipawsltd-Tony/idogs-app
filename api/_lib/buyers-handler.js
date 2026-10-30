import { createHash } from 'node:crypto'
import { ApiError, parseJsonBody } from './http-helpers.js'
import { canManagePrivateDogAccess } from './private-dog-access.js'
import { joinFinanceBuyers } from './finance-buyers.js'

const statuses = ['enquiry', 'waiting', 'reserved', 'deposit', 'transferred', 'closed']
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max + 1) : ''
export function validateBuyer(body) {
  const name = text(body.name, 120), email = text(body.email, 254).toLowerCase(), phone = text(body.phone, 40), notes = text(body.notes, 2000)
  const status = body.status, dogId = text(body.dogId, 128)
  const amount = body.amount === '' || body.amount == null ? null : Number(body.amount)
  if (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || phone.length > 40 || notes.length > 2000 || !statuses.includes(status)) throw new ApiError(400, 'Enter a name, valid email and buyer status.')
  if (dogId && !/^[\w-]{1,128}$/.test(dogId)) throw new ApiError(400, 'Choose a valid puppy.')
  if (['deposit', 'reserved'].includes(status) && !dogId) throw new ApiError(400, 'Choose a puppy for this reservation or deposit.')
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1000000)) throw new ApiError(400, 'Enter a valid deposit amount in AUD.')
  return { name, email, phone, notes, status, dogId, amount }
}

// Server-only collection. No Firestore client rules or buyer viewing rights are added.
export function createBuyersHandler({ db, verifyToken, timestamp = () => new Date().toISOString() }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed')
    let identity
    try { identity = await verifyToken((req.headers.authorization || '').replace(/^Bearer /, '')) } catch { throw new ApiError(401, 'Please sign in again.') }
    if (!identity?.uid) throw new ApiError(401, 'Please sign in again.')
    if (identity.email_verified !== true) throw new ApiError(403, 'Verify your email before managing buyers')
    const uid = identity.uid, body = parseJsonBody(req), collection = db.collection('buyerContacts')
    if (body.action === 'list') {
      const [snap, finance] = await Promise.all([collection.where('ownerUid', '==', uid).limit(501).get(), db.collection('financeDocuments').where('tenantId', '==', uid).get()])
      if (snap.docs.length > 500) throw new ApiError(409, 'Buyer list limit reached. Please contact support.')
      return res.status(200).json({ buyers: joinFinanceBuyers(snap.docs.map(doc => ({ ...doc.data(), id: doc.id })), finance.docs.map(doc => ({ ...doc.data(), id: doc.id })), uid) })
    }
    if (body.action !== 'save') throw new ApiError(400, 'Invalid action')
    const buyer = validateBuyer(body)
    const id = createHash('sha256').update(`${uid}\n${buyer.email}`).digest('hex'), ref = collection.doc(id)
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref)
      const old = previous.data()
      if (old && old.ownerUid !== uid) throw new ApiError(403, 'Not authorised')
      // Release/reassignment must use the puppy's reservation workflow so its
      // grant, finance and sale state cannot silently drift from this list.
      if (old?.dogId && ['reserved', 'deposit'].includes(old.status) && (old.dogId !== buyer.dogId || !['reserved', 'deposit'].includes(buyer.status))) {
        const oldDog = await tx.get(db.collection('dogs').doc(old.dogId))
        const dog = oldDog.data()
        if (oldDog.exists && canManagePrivateDogAccess(dog, uid) && dog.status !== 'transferred' && (dog.reservedForEmail || '').trim().toLowerCase() === old.email && dog.availabilityStatus === 'reserved') throw new ApiError(409, 'Release or transfer the puppy from its profile before changing this buyer’s stage or puppy.')
      }
      if (buyer.dogId) {
        const dogRef = db.collection('dogs').doc(buyer.dogId), dogSnap = await tx.get(dogRef), dog = dogSnap.data()
        if (!dogSnap.exists || !canManagePrivateDogAccess(dog, uid) || dog.status === 'transferred') throw new ApiError(403, 'Choose a puppy you currently own. Record a past transfer without linking a puppy.')
        if (['reserved', 'deposit'].includes(buyer.status)) {
          const existing = (dog.reservedForEmail || '').trim().toLowerCase()
          if (dog.availabilityStatus === 'sold' || (dog.availabilityStatus === 'reserved' && (existing !== buyer.email || (!existing && dog.reservedForName)))) throw new ApiError(409, 'This puppy already has a buyer. Update its reservation from the puppy profile first.')
          if (dog.depositStatus === 'received' && buyer.status !== 'deposit') throw new ApiError(409, 'Manage changes to a received deposit from the puppy profile.')
          // Read grants before writing; a stale grant must not follow a new reservation.
          const grantRef = db.collection('dogPrivateAccess').doc(buyer.dogId), grant = await tx.get(grantRef)
          if (grant.exists && (grant.data().buyerEmail || '').toLowerCase() !== buyer.email) tx.update(grantRef, { status: 'revoked', updatedAt: timestamp() })
          tx.update(dogRef, { reservedForName: buyer.name, reservedForEmail: buyer.email, reservedForPhone: buyer.phone, reservedAt: dog.reservedAt || new Date().toISOString().slice(0, 10), availabilityStatus: 'reserved', depositStatus: buyer.status === 'deposit' ? 'received' : 'pending', depositAmount: buyer.amount ?? (existing === buyer.email ? dog.depositAmount || 0 : 0), updatedAt: timestamp() })
        }
        if (buyer.status === 'transferred') throw new ApiError(400, 'Use Transfer on the puppy profile to transfer ownership, or leave Puppy blank to record a past buyer.')
      }
      tx.set(ref, { ...buyer, ...(old?.address ? { address: old.address } : {}), ownerUid: uid, createdAt: old?.createdAt || timestamp(), updatedAt: timestamp() })
    })
    return res.status(200).json({ buyer: { ...(await ref.get()).data(), id } })
  }
}
