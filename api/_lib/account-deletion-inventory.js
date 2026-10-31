import { createHash } from 'node:crypto'
import { classifyDeletionDog } from './account-deletion.js'

// Read-only discovery manifest. A candidate is NOT authorization to delete.
export const ACCOUNT_QUERIES = {
  dogs: ['tenantId', 'currentOwnerId', 'createdByUserId', 'originBreederId'],
  vaccineRecords: ['tenantId', 'createdBy'], wormingRecords: ['tenantId', 'createdBy'],
  healthTests: ['tenantId', 'createdBy'], reminders: ['tenantId'],
  activityNotes: ['tenantId', 'createdBy'], documents: ['tenantId'], heatCycles: ['tenantId'],
  litters: ['tenantId'], litterShowcases: ['tenantId'], showcaseEnquiries: ['tenantId'],
  dogPrivateAccess: ['ownerId', 'ownerUid'], passportReservations: ['tenantId', 'uid'],
  litterPuppyOperations: ['tenantId', 'uid'], litterQuotaCredits: ['tenantId', 'userId'],
  litterQuotaLedger: ['tenantId', 'userId'], mediaUploadGrants: ['uid', 'userId', 'tenantId'],
  mediaUploadQuotas: ['uid', 'userId'], smsDeliveries: ['tenantId'], reminderEmailDeliveries: ['tenantId'], auditLogs: ['tenantId', 'userId'],
  supportConversations: ['ownerUid'], supportMessages: ['senderUid'], supportFaqFeedback: ['ownerUid'],
  buyerContacts: ['ownerUid'],
  accountDeletionRenewalTasks: ['uid'],
}
// Query coverage is not a retention/disposition decision. These records stay
// unclassified even after their owner-scoped discovery query is restored.
const REVIEW_ONLY_COLLECTIONS = new Set(['buyerContacts'])
const DOG_COLLECTIONS = ['vaccineRecords', 'wormingRecords', 'healthTests', 'reminders', 'activityNotes',
  'documents', 'heatCycles', 'dogPrivateAccess', 'scanLogs', 'mediaUploadGrants', 'passportReservations']
const LITTER_COLLECTIONS = ['litterShowcases', 'showcaseEnquiries', 'litterPuppyOperations', 'smsDeliveries']
const PATH_KEYS = new Set(['path', 'filePath', 'documentPath', 'storagePath', 'microchipCertPath'])
const URL_KEYS = new Set(['url', 'fileUrl', 'documentUrl', 'photoUrl', 'profilePhoto', 'microchipCertUrl'])
const EXPECTED_GLOBAL_COLLECTIONS = new Set(['supportFaqs', 'supportRateLimits', 'processedStripeEvents',
  'accountDeletionRequests', 'plusPromotionCheckouts', 'surveyResponses', 'scanLogs', 'landingMediaDrafts', 'landingMediaPublished',
  'mediaUploadGrants', 'mediaUploadQuotas', ...Object.keys(ACCOUNT_QUERIES)])

function mediaReferences(data) {
  const paths = new Set()
  let legacyUrlCount = 0
  function visit(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (PATH_KEYS.has(key) && typeof item === 'string' && item) {
        if (!item.includes('://') && !item.startsWith('/') && !item.split('/').includes('..')) paths.add(item)
        else legacyUrlCount++
      } else if (URL_KEYS.has(key) && typeof item === 'string' && item) legacyUrlCount++
      else if (typeof item === 'object') visit(item)
    }
  }
  visit(data)
  return { paths: [...paths].sort(), legacyUrlCount }
}

export async function buildDeletionInventory({ db, uid, limit = 200, now = Date.now() }) {
  if (typeof uid !== 'string' || !uid || uid.includes('/') || uid.length > 128) throw new Error('Invalid account identifier')
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid inventory limit')
  const found = new Map(), errors = new Set(), truncated = new Set(), subcollections = new Set()
  function remember(document) {
    if (found.has(document.ref.path) || found.size < 500) found.set(document.ref.path, document)
    else truncated.add('total_records')
  }
  async function discover(collection, field, value) {
    try {
      const result = await db.collection(collection).where(field, '==', value).limit(limit + 1).get()
      if (result.size > limit) truncated.add(`${collection}:${field}`)
      for (const document of result.docs.slice(0, limit)) remember(document)
    } catch { errors.add(`${collection}:${field}`) }
  }
  let profile = null, rootCollections = []
  try {
    const doc = await db.collection('users').doc(uid).get()
    if (doc.exists) { profile = doc.data(); remember(doc) }
    else errors.add('users:missing_profile')
    rootCollections = (await db.listCollections()).map(c => c.id)
  } catch { errors.add('collection_discovery') }
  // Checkout ledgers are keyed by UID; their payload has no ownership field to query.
  try {
    const doc = await db.collection('plusPromotionCheckouts').doc(uid).get()
    if (doc.exists) remember(doc)
  } catch { errors.add('plusPromotionCheckouts:document') }
  // Bounded sequential batches limit load without claiming a global snapshot.
  for (const [collection, fields] of Object.entries(ACCOUNT_QUERIES)) {
    await Promise.all(fields.map(field => discover(collection, field, uid)))
  }
  if (typeof profile?.email === 'string' && profile.email.trim()) {
    const email = profile.email.trim().toLowerCase()
    await Promise.all([discover('surveyResponses', 'email', email), discover('dogs', 'buyerEmail', email)])
  }
  const dogs = [...found.values()].filter(d => d.ref.parent.id === 'dogs')
  const dogStates = new Map(dogs.map(d => [d.id, classifyDeletionDog(d.data(), uid)]))
  if (dogs.length > 25) truncated.add('linked_dog_queries')
  for (const dog of dogs.slice(0, 25)) {
    await Promise.all(DOG_COLLECTIONS.map(collection => discover(collection, 'dogId', dog.id)))
    for (const collection of ['dogPrivateAccess', 'passportReservations']) {
      const id = collection === 'dogPrivateAccess' ? dog.id : dog.data().passportId
      if (!id || typeof id !== 'string' || id.includes('/')) continue
      try { const d = await db.collection(collection).doc(id).get(); if (d.exists) remember(d) }
      catch { errors.add(`${collection}:document`) }
    }
  }
  const litters = [...found.values()].filter(d => d.ref.parent.id === 'litters')
  if (litters.length > 25) truncated.add('linked_litter_queries')
  for (const litter of litters.slice(0, 25)) await Promise.all(LITTER_COLLECTIONS.map(c => discover(c, 'litterId', litter.id)))
  const conversations = [...found.values()].filter(d => d.ref.parent.id === 'supportConversations')
  if (conversations.length > 25) truncated.add('linked_conversation_queries')
  for (const conversation of conversations.slice(0, 25)) await discover('supportMessages', 'conversationId', conversation.id)

  const records = []
  for (const document of found.values()) {
    const data = document.data(), collection = document.ref.parent.id
    const dogId = collection === 'dogs' ? document.id : data.dogId
    const dogState = dogId ? dogStates.get(dogId) : null
    let disposition = 'review_account_record'
    if (collection === 'accountDeletionRenewalTasks') disposition = 'review_workflow_retention'
    if (collection === 'plusPromotionCheckouts') disposition = 'review_billing_retention'
    if (dogState === 'preserve_other_owner') disposition = 'preserve_other_owner'
    else if (dogState === 'review_pending_transfer') disposition = 'review_pending_transfer'
    else if (dogState === 'review_legacy_ownership') disposition = 'review_legacy_ownership'
    else if (dogId && !dogState) disposition = 'review_unresolved_dog'
    else if (dogState === 'review_owned_data') disposition = 'review_owned_data'
    if (REVIEW_ONLY_COLLECTIONS.has(collection)) disposition = 'review_buyer_contact_retention'
    // Discovery of unscanned nested data always blocks a complete-inventory claim.
    try { for (const c of await document.ref.listCollections()) subcollections.add(c.path) }
    catch { errors.add(`${collection}:subcollections`) }
    records.push({ path: document.ref.path, version: document.updateTime?.toDate?.().toISOString() || null,
      disposition, media: collection === 'plusPromotionCheckouts' ? { paths: [], legacyUrlCount: 0 } : mediaReferences(data) })
  }
  records.sort((a, b) => a.path.localeCompare(b.path))
  const unknownCollections = rootCollections.filter(c => (REVIEW_ONLY_COLLECTIONS.has(c) || !EXPECTED_GLOBAL_COLLECTIONS.has(c)) && c !== 'users').sort()
  const holds = ['write_freeze_not_verified', 'billing_provider_verification', 'storage_object_inventory',
    'external_provider_retention', 'shared_history_retention_review']
  if (errors.size) holds.push('query_failed')
  if (truncated.size) holds.push('query_truncated')
  if (subcollections.size) holds.push('nested_collections_not_scanned')
  if (unknownCollections.length) holds.push('unclassified_collections')
  if (records.some(r => r.media.legacyUrlCount)) holds.push('legacy_media_review')
  if (records.some(r => !r.version)) holds.push('record_version_missing')
  return {
    version: '2026-10-19-v1', checkedAt: new Date(now).toISOString(), complete: false, readyForDeletion: false,
    fingerprint: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    reason: 'Read-only inventory. It is not a deletion authorization; provider, storage, retention and write-freeze checks are outstanding.',
    records, dogs: dogs.map(d => ({ id: d.id, disposition: dogStates.get(d.id) })),
    counts: { records: records.length, dogs: dogs.length, litters: litters.length, conversations: conversations.length },
    holds, errors: [...errors].sort(), truncated: [...truncated].sort(),
    unscannedSubcollections: [...subcollections].sort(), unknownCollections,
    billingReviewRequired: !!(found.has(`plusPromotionCheckouts/${uid}`) || profile?.stripeCustomerId || profile?.stripeSubscriptionId || profile?.smsStripeSubscriptionId || profile?.subscriptionStatus === 'active'),
    // Even false here is not provider confirmation of no subscription.
  }
}
