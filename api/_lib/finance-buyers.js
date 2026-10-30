import { createHash } from 'node:crypto'
import { ApiError } from './http-helpers.js'
import { canManagePrivateDogAccess } from './private-dog-access.js'

export const buyerContactId = (uid, email) => createHash('sha256').update(`${uid}\n${email.trim().toLowerCase()}`).digest('hex')
export const financeDeposit = doc => doc.type === 'invoice' ? Number(doc.depositPaidCents || 0) : doc.type === 'receipt' && doc.paymentPurpose === 'deposit' ? Number(doc.depositTotalCents || doc.amountPaidCents || 0) : 0

// Include old document-only customers without rewriting issued snapshots.
export function joinFinanceBuyers(contacts, documents, uid) {
  const map = new Map(contacts.map(c => [c.email || c.id, { ...c, documents: [] }]))
  for (const doc of documents) {
    const email = String(doc.buyer?.email || '').trim().toLowerCase()
    const key = email || `document-${doc.id}`
    let buyer = map.get(key)
    if (!buyer) {
      buyer = { id: email ? buyerContactId(uid, email) : '', name: doc.buyer?.name || 'Buyer', email, phone: doc.buyer?.phone || '', address: doc.buyer?.address || '', notes: '', status: 'enquiry', dogId: '', amount: null, documents: [] }
      map.set(key, buyer)
    }
    buyer.documents.push({ id: doc.id, documentNumber: doc.documentNumber, type: doc.type, issueDate: doc.issueDate, dogId: doc.dog?.id || '', dogName: doc.dog?.name || '', depositPaidCents: financeDeposit(doc) })
  }
  return [...map.values()]
}

// All reads precede writes. Caller commits this plan with the document and
// counter in one transaction; issued documents remain immutable snapshots.
export async function prepareFinanceBuyer({ db, tx, uid, buyer, dog, dogId, type, body, depositPaidCents, amountPaidCents, timestamp }) {
  const email = buyer.email
  const deposit = type === 'invoice' ? depositPaidCents : type === 'receipt' && body.paymentPurpose === 'deposit' ? body.depositTotalCents : 0
  if (deposit && (!Number.isSafeInteger(deposit) || deposit < amountPaidCents && type === 'receipt' || deposit > 100000000)) throw new ApiError(400, 'Total deposit must cover this receipt amount and be a valid AUD amount.')
  if (type === 'receipt' && body.paymentPurpose === 'deposit' && !deposit) throw new ApiError(400, 'Enter the total deposit received to date.')
  if (deposit && !email) throw new ApiError(400, 'A buyer email is required to link a deposit.')
  const ref = email ? db.collection('buyerContacts').doc(buyerContactId(uid, email)) : null
  const previous = ref ? await tx.get(ref) : null, old = previous?.data()
  if (old && old.ownerUid !== uid) throw new ApiError(403, 'Buyer not authorised')
  let dogPatch = null, grantRef = null, revokeGrant = false
  if (deposit) {
    if (!canManagePrivateDogAccess(dog, uid) || dog.status === 'transferred') throw new ApiError(409, 'Deposit can only be recorded for a puppy you currently own.')
    const reservedEmail = (dog.reservedForEmail || '').trim().toLowerCase()
    if (dog.availabilityStatus === 'sold' || (dog.availabilityStatus === 'reserved' && reservedEmail !== email)) throw new ApiError(409, 'This puppy has a different buyer. Update its reservation first.')
    const known = dog.depositStatus === 'received' && reservedEmail === email ? Math.round(Number(dog.depositAmount || 0) * 100) : 0
    if (deposit < known) throw new ApiError(409, 'The deposit is below the amount already recorded. Manage refunds from the puppy profile.')
    grantRef = db.collection('dogPrivateAccess').doc(dogId)
    const grant = await tx.get(grantRef)
    revokeGrant = grant.exists && (grant.data().buyerEmail || '').toLowerCase() !== email
    dogPatch = { reservedForName: buyer.name, reservedForEmail: email, reservedForPhone: buyer.phone, reservedAt: dog.reservedAt || new Date().toISOString().slice(0, 10), availabilityStatus: 'reserved', depositStatus: 'received', depositAmount: deposit / 100, updatedAt: timestamp() }
  }
  const contact = ref ? { ...(old || {}), name: old?.name || buyer.name, email, phone: old?.phone || buyer.phone, address: old?.address || buyer.address, notes: old?.notes || '', status: deposit ? 'deposit' : old?.status || 'enquiry', dogId: deposit ? dogId : old?.dogId || '', amount: deposit ? deposit / 100 : old?.amount ?? null, ownerUid: uid, createdAt: old?.createdAt || timestamp(), updatedAt: timestamp() } : null
  return { buyerId: ref?.id || '', depositTotalCents: deposit || 0, apply() { if (ref) tx.set(ref, contact); if (dogPatch) tx.update(db.collection('dogs').doc(dogId), dogPatch); if (revokeGrant) tx.update(grantRef, { status: 'revoked', updatedAt: timestamp() }) } }
}
