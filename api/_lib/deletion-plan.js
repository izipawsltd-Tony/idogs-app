import { createHash } from 'node:crypto'
import { FieldPath } from 'firebase-admin/firestore'
import { DELETION_LOCKS, MUTATION_LEASES, DELETION_JOBS, DELETION_RECEIPTS, validAccountId } from './deletion-fence.js'

const CONTROL = new Set([DELETION_LOCKS, MUTATION_LEASES, DELETION_JOBS, DELETION_RECEIPTS, 'accountDeletionRequests', 'accountDeletionRenewalTasks', 'deletionSyntheticProviders'])
const KNOWN = new Set(['users','dogs','vaccineRecords','wormingRecords','healthTests','activityNotes','documents','reminders','heatCycles','scanLogs','litters','litterShowcases','showcaseEnquiries','ownershipHistorySnapshots','dogPrivateAccess','passportReservations','litterPuppyOperations','litterQuotaLedger','litterQuotaCredits','mediaUploadGrants','mediaUploadQuotas','landingMediaUploadGrants','financeDocuments','financeCounters','smsDeliveries','reminderEmailDeliveries','auditLogs','supportConversations','supportMessages','supportFaqFeedback','supportRateLimits','surveyResponses','rateLimitCounters','superAdminVerificationEmailRateLimits','superAdminPasswordResetRateLimits'])
KNOWN.add('plusPromotionCheckouts')
const FINANCIAL = new Set(['financeDocuments','financeCounters','litterQuotaLedger','litterQuotaCredits','smsDeliveries','plusPromotionCheckouts'])
const ID_KEYS = new Set(['uid','userId','tenantId','ownerUid','ownerId','currentOwnerId','createdBy','createdByUserId','originBreederId','previousOwnerId','fromOwnerId','originalBreederId','performedBy','senderUid','claimedBy','reservedForUid','toOwnerId','assignedBy'])
const CONTACT_KEYS = new Set(['email','ownerEmail','buyerEmail','toOwnerEmail','performedByEmail','phone','buyerPhone','ownerPhone','address','firstName','lastName','ownerName','buyerName','toOwnerName','contactName','displayName'])
const MEDIA_KEYS = new Set(['path','filePath','storagePath','documentPath','microchipCertPath','url','fileUrl','documentUrl','photoUrl','profilePhoto','microchipCertUrl'])
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export const versionOf = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null
const ownerOf = data => Object.hasOwn(data, 'currentOwnerId') ? data.currentOwnerId : data.tenantId

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(v => strings(v,out))
  else if (value && typeof value === 'object' && !value.toDate) Object.values(value).forEach(v => strings(v,out))
  return out
}
// Inspect nested free text without persisting the departing email in a job.
// This is a conservative hold check, not a claim to find every personal datum.
export function containsDeletionIdentity(data,uid,emailHash){
  const hashes=new Set(Array.isArray(emailHash)?emailHash:[emailHash])
  return strings(data).some(s=>s.includes(uid)||[...(s.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[])].some(email=>hashes.has(digest(email.toLowerCase()))))
}
function related(data, needles) { return strings(data).some(s => needles.has(s) || [...needles].some(n => n.length > 4 && (n.includes('@') ? s.toLowerCase().includes(n.toLowerCase()) : s.includes(n)))) }

// Includes missing parent document references, so orphaned subcollections are
// discovered too. Pagination/limits fail closed, never silently truncate.
export async function scanDeletionDocuments(db, { pageSize = 100, maxDocuments = 5000, maxCollections = 200 } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 5000 || !Number.isInteger(maxCollections) || maxCollections < 1 || maxCollections > 200) throw new Error('INVALID_INVENTORY_LIMIT')
  const queue = (await db.listCollections()).filter(c => !CONTROL.has(c.id))
  const seen = new Set(), records = [], holds = new Set()
  while (queue.length) {
    const col = queue.shift()
    if (seen.has(col.path)) continue
    seen.add(col.path)
    if (seen.size > maxCollections) { holds.add('inventory_limit'); break }
    let cursor
    do {
      let q = col.orderBy(FieldPath.documentId()).limit(pageSize)
      if (cursor) q = q.startAfter(cursor)
      const page = await q.get()
      for (const snap of page.docs) {
        records.push({ path:snap.ref.path, collection:col.id, data:snap.data(), version:versionOf(snap) })
        if (records.length > maxDocuments) { holds.add('inventory_limit'); break }
      }
      if (holds.size || page.size < pageSize) break
      cursor = page.docs.at(-1)
    } while (cursor)
    if (holds.size) break
    // listDocuments includes deleted parents that still have descendants.
    const refs = await col.listDocuments()
    if (refs.length > maxDocuments) { holds.add('inventory_limit'); break }
    for (const ref of refs) queue.push(...await ref.listCollections())
  }
  return { records, holds:[...holds], collections:[...seen] }
}

export function mediaPaths(data, bucketName) {
  const paths = new Set(), invalid = new Set()
  function walk(v) {
    if (!v || typeof v !== 'object' || v.toDate) return
    for (const [key, val] of Object.entries(v)) {
      if (MEDIA_KEYS.has(key) && typeof val === 'string' && val) {
        let p = val
        if (p.includes('://')) {
          try {
            const url = new URL(p)
            if (url.protocol === 'gs:' && url.hostname === bucketName) p = url.pathname.slice(1)
            else if (url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && url.pathname.startsWith(`/${bucketName}/`)) p = decodeURIComponent(url.pathname.slice(bucketName.length + 2))
            else if (url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(`/v0/b/${bucketName}/o/`)) p = decodeURIComponent(url.pathname.split('/o/')[1])
            else { invalid.add('unresolved_media_reference'); continue }
          } catch { invalid.add('unresolved_media_reference'); continue }
        }
        if (!p || p.startsWith('/') || p.includes('://') || p.includes('\\') || p.split('/').some(s => !s || s === '.' || s === '..')) invalid.add('unresolved_media_reference')
        else paths.add(p)
      } else if (val && typeof val === 'object') walk(val)
    }
  }
  walk(data)
  return { paths:[...paths].sort(), holds:[...invalid] }
}

function redactShared(data, uid, profile, pseudonym, changes = {}, prefix = '', holds = new Set()) {
  for (const [key,val] of Object.entries(data)) {
    const field = prefix ? `${prefix}.${key}` : key
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { if (related(val,new Set([uid,profile.email].filter(Boolean)))) holds.add('shared_content_review'); continue }
    if (typeof val === 'string') {
      if (val === uid && ID_KEYS.has(key)) changes[field] = pseudonym
      else if (CONTACT_KEYS.has(key) && [profile.email,profile.phone,profile.address,profile.firstName,profile.lastName,[profile.firstName,profile.lastName].filter(Boolean).join(' ')].filter(Boolean).includes(val)) changes[field] = null
      else if (!MEDIA_KEYS.has(key) && related(val,new Set([uid,profile.email].filter(Boolean)))) holds.add('shared_content_review')
    } else if (Array.isArray(val)) {
      if (related(val,new Set([uid,profile.email].filter(Boolean)))) holds.add('shared_content_review')
    } else if (val && typeof val === 'object' && !val.toDate) redactShared(val,uid,profile,pseudonym,changes,field,holds)
  }
  return { changes, holds:[...holds] }
}

export async function buildEmulatorDeletionPlan({ db, bucket, uid, now = Date.now(), decisions = {}, limits }) {
  if (!validAccountId(uid)) throw new Error('INVALID_ACCOUNT')
  const scan = await scanDeletionDocuments(db,limits)
  const holds = new Set(scan.holds), operations = [], retained = []
  const profile = scan.records.find(r => r.path === `users/${uid}`)?.data
  if (!profile) return { holds:[...new Set([...holds,'profile_missing'])], operations:[], retained:[], fingerprint:digest([]) }
  const needles = new Set([uid,profile.email].filter(Boolean))
  // Recursive collection IDs are not ownership authority: a follower relation
  // such as puppyFollowers/{uid}/dogs/{id} may share a root dog's ID.
  const dogs = new Map(scan.records.filter(r => /^dogs\/[^/]+$/.test(r.path)).map(r => [r.path.split('/')[1],r]))
  const owned = new Set(), shared = new Set()
  for (const [id,r] of dogs) if (related(r.data,needles)) {
    if (!Object.hasOwn(r.data,'currentOwnerId') || !validAccountId(r.data.currentOwnerId)) holds.add('legacy_ownership_review')
    else if (r.data.currentOwnerId === uid) {
      owned.add(id)
      if (r.data.transferStatus === 'pendingClaim' || r.data.status === 'transferred' || r.data.historySnapshotId || r.data.previousOwnerId) holds.add('ownership_history_review')
    } else shared.add(id)
  }
  const relatedPaths = new Set([`users/${uid}`,`plusPromotionCheckouts/${uid}`])
  // Some account-rooted trees carry identity only in the ancestor document ID
  // (for example puppyFollowers/{uid}/dogs/{dogId}). Unknown descendants must
  // hold even when their payload contains no UID. This exact ancestor match is
  // conservative quarantine, never an ownership classification or delete grant.
  const scopedDogs = new Set([...owned,...shared])
  for(const r of scan.records){
    const segments=r.path.split('/')
    // Unknown dog-rooted descendants can carry identity only in the path too.
    // Exact dog IDs quarantine them; no nested record supplies dog authority.
    const scopedDogPath = scopedDogs.has(segments[1]) || segments.some((segment,index) => index%2===0 && segment==='dogs' && scopedDogs.has(segments[index+1]))
    if(segments.length>2&&(segments[1]===uid||scopedDogPath))relatedPaths.add(r.path)
  }
  const relatedIds = new Set([...needles,...owned,...shared])
  // Fixed point discovers conversations, litter children, snapshots and nested
  // document references without relying on a single tenantId equality query.
  for (let changed=true;changed;) {
    changed=false
    for (const r of scan.records) if (!relatedPaths.has(r.path) && (r.path.startsWith(`users/${uid}/`) || related(r.data,relatedIds))) {
      relatedPaths.add(r.path); relatedIds.add(r.path.split('/').at(-1)); changed=true
    }
  }
  const mediaRefs = new Map()
  for (const r of scan.records) for (const p of mediaPaths(r.data,bucket.name).paths) {
    if (!mediaRefs.has(p)) mediaRefs.set(p,[])
    mediaRefs.get(p).push(r.path)
  }
  const deletingPaths = new Set(), pseudonym = `deleted_${digest(uid).slice(0,32)}`
  for (const r of scan.records.filter(r => relatedPaths.has(r.path))) {
    if (!KNOWN.has(r.collection) || r.path.split('/').length !== 2) { holds.add('unclassified_record_review'); continue }
    if (!r.version) { holds.add('record_version_missing'); continue }
    const dogId = r.collection === 'dogs' ? r.path.split('/').at(-1) : r.data.dogId
    const dog = dogs.get(dogId)?.data
    const isShared = shared.has(dogId) || (dog && ownerOf(dog) !== uid)
    if (isShared) {
      const redaction = redactShared(r.data,uid,profile,pseudonym)
      redaction.holds.forEach(h => holds.add(h))
      if (Object.keys(redaction.changes).length) operations.push({kind:'redact',path:r.path,expectedVersion:r.version,changes:redaction.changes})
      // Bind the exemption to the reviewed content after the planned redaction,
      // so a later write cannot smuggle departing identity into a retained path.
      const expected=canonical(r.data)
      for(const [field,value] of Object.entries(redaction.changes)){
        const keys=field.split('.'),last=keys.pop()
        let target=expected
        for(const key of keys)target=target[key]
        target[last]=value
      }
      retained.push({path:r.path,category:'current_owner_history',expectedDataHash:digest(expected),reason:'Preserve the other current owner; redact only proven departing identity fields.'})
      continue
    }
    // A related record owned by somebody else is never silently deleted.
    if (['tenantId','ownerUid','ownerId','userId'].some(k => validAccountId(r.data[k]) && r.data[k] !== uid) && !owned.has(dogId)) {
      holds.add('foreign_record_review'); continue
    }
    if (r.collection === 'mediaUploadGrants' || r.collection === 'landingMediaUploadGrants') {
      const expires = Date.parse(r.data.expiresAt)
      if (!Number.isFinite(expires) || expires + 60000 > now) holds.add('signed_upload_not_drained')
    }
    if (FINANCIAL.has(r.collection) || r.collection === 'ownershipHistorySnapshots' || r.collection === 'passportReservations') {
      const d = decisions[r.path]
      if (!d || d.expectedVersion !== r.version || d.action !== 'retain' || typeof d.reason !== 'string' || !d.reason.trim() || d.reason.length > 200 || !Number.isFinite(Date.parse(d.reviewAfter)) || Date.parse(d.reviewAfter) <= now) { holds.add('retention_review'); continue }
      retained.push({path:r.path,category:FINANCIAL.has(r.collection)?'reviewed_financial_record':'reviewed_history',expectedDataHash:digest(r.data),reason:d.reason,reviewAfter:d.reviewAfter})
      continue
    }
    mediaPaths(r.data,bucket.name).holds.forEach(h => holds.add(h))
    operations.push({kind:'delete',path:r.path,expectedVersion:r.version})
    deletingPaths.add(r.path)
  }
  const media = []
  let query = {autoPaginate:false,maxResults:100}
  let objects=0
  do {
    const [files,next] = await bucket.getFiles(query)
    for (const file of files) {
      if (++objects > 5000) { holds.add('storage_inventory_limit'); break }
      const refs = mediaRefs.get(file.name) || []
      const exclusive = refs.length > 0 && refs.every(p => deletingPaths.has(p))
      const ownOrphan = !refs.length && ['dogs','documents'].some(root => file.name.startsWith(`${root}/${uid}/`))
      if (!refs.length && !ownOrphan && file.name.split('/').includes(uid)) holds.add('unclassified_media_review')
      if (exclusive || ownOrphan) {
        const [meta] = await file.getMetadata()
        if (!meta.generation) holds.add('storage_version_missing')
        else media.push({kind:'media',path:file.name,generation:String(meta.generation)})
      }
    }
    if (holds.has('storage_inventory_limit')) break
    query=next
  } while(query)
  // Profile is removed after all dependent data. Auth is always last.
  operations.sort((a,b) => (a.path === `users/${uid}`?1:0)-(b.path === `users/${uid}`?1:0) || a.path.localeCompare(b.path))
  const plan = {operations:[...media,...operations],retained,holds:[...holds].sort()}
  return {...plan,profileEmailHash:digest((profile.email||'').toLowerCase()),fingerprint:digest(plan),counts:{records:scan.records.length,operations:plan.operations.length,retained:retained.length}}
}
