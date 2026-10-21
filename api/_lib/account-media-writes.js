import { ApiError } from './http-helpers.js'
import { canAddDogRecord, hasDogWriteAccess } from './dog-access.js'
import { requireAccountWrites } from './account-write-fence.js'

export const MEDIA_OPERATIONS = 'accountMediaOperations'
const generationOf = metadata => {
  const value = String(metadata?.generation || '')
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('storage_generation_unverified')
  return value
}
async function writableDog(tx, db, uid, dogId) {
  await requireAccountWrites(tx, db, uid)
  const snap = await tx.get(db.collection('dogs').doc(dogId))
  if (!snap.exists) throw new ApiError(404, 'Dog not found')
  const dog = snap.data()
  if (!canAddDogRecord(dog, uid) || dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') {
    const reason = hasDogWriteAccess(dog, uid) && dog.status === 'restricted' ? 'DOG_RESTRICTED'
      : hasDogWriteAccess(dog, uid) && (dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') ? 'DOG_TRANSFER_IN_PROGRESS' : 'NOT_OWNER'
    throw new ApiError(403, 'Not authorized to upload media for this dog', { reason })
  }
  return dog
}

// Storage cannot join a Firestore transaction. Persist the operation BEFORE
// sending bytes, use a fresh immutable path and recheck owner/fence atomically
// with the reference write. Unresolved operations must block permanent cleanup.
// There is no timeout that silently treats an ambiguous Storage write as gone.
export async function uploadAccountMedia({ db, bucket, uid, dogId, path, kind, buffer, contentType, publicRead = false, commit }) {
  if (![uid, dogId].every(v => typeof v === 'string' && v && !v.includes('/'))
    || !['document', 'profile', 'note', 'showcase'].includes(kind)
    || typeof path !== 'string' || !path.startsWith(`${kind === 'document' ? 'documents' : 'dogs'}/${uid}/${dogId}/`)
    || path.split('/').some(p => !p || p === '.' || p === '..') || !bucket?.name) throw new Error('invalid_media_operation')
  const ref = db.collection(MEDIA_OPERATIONS).doc()
  await db.runTransaction(async tx => {
    await writableDog(tx, db, uid, dogId)
    tx.create(ref, { uid, dogId, bucket: bucket.name, path, kind, state: 'uploading', createdAt: new Date().toISOString() })
  })
  const file = bucket.file(path)
  let generation
  try {
    await file.save(buffer, { metadata: { contentType }, preconditionOpts: { ifGenerationMatch: 0 } })
    generation = generationOf((await file.getMetadata())[0])
    if (publicRead) await file.makePublic()
    const result = await db.runTransaction(async tx => {
      const operation = (await tx.get(ref)).data()
      const dog = await writableDog(tx, db, uid, dogId)
      if (operation?.state !== 'uploading' || operation.uid !== uid || operation.path !== path) throw new Error('media_operation_changed')
      const result = commit ? await commit(tx, dog, generation) : undefined
      tx.update(ref, { state: 'committed', generation, updatedAt: new Date().toISOString() })
      return result
    })
    return { operationId: ref.id, path, generation, result }
  } catch (error) {
    // A lost commit response is ambiguous: read the durable outcome before
    // cleanup. If readback fails, retain the file and journal for review.
    try {
      await db.runTransaction(async tx => {
        const outcome = (await tx.get(ref)).data()
        if (outcome?.state === 'committed') return
        tx.update(ref, { state: 'cleanup_required', ...(generation ? { generation } : {}), updatedAt: new Date().toISOString() })
      })
    } catch { /* Preserve durable unresolved state for review. */ }
    // Do not delete here: generation/shared-reference/version-retention review
    // belongs to a separately verified cleanup worker. A lost acknowledgement
    // or replaced object must never turn a request failure into data loss.
    throw error
  }
}

export async function reorderAccountMedia({ db, uid, dogId, arrayField, order }) {
  if (!['photos', 'videos'].includes(arrayField) || !Array.isArray(order) || order.some(id => typeof id !== 'string')) throw new ApiError(400, 'Invalid media order')
  return db.runTransaction(async tx => {
    const dog = await writableDog(tx, db, uid, dogId)
    const current = dog[arrayField] || [], byId = new Map(current.map(item => [item.id, item]))
    const ids = new Set(order)
    if (ids.size !== order.length) throw new ApiError(400, 'order must not contain duplicate entries')
    if (order.some(id => !byId.has(id))) throw new ApiError(400, 'order contains an unknown media item', { reason: 'UNKNOWN_MEDIA_ITEM' })
    tx.update(db.collection('dogs').doc(dogId), { [arrayField]: order.map(id => byId.get(id)), updatedAt: new Date() })
    return { removedItems: current.filter(item => !ids.has(item.id)) }
  })
}
