import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, setDoc, Timestamp, runTransaction
} from 'firebase/firestore'
import { db, auth } from './firebase'
import type { Dog, DogFormData, VaccineRecord, WormingRecord, HealthTest, Reminder, ActivityNote, UserProfile, Litter, LifeStage } from '../types'
import { nanoid, calculateLifeStage, LIFE_STAGE_LABELS } from './utils'

function uid(): string {
  return auth.currentUser?.uid ?? ''
}

function toDate(ts: Timestamp | string | undefined): string {
  if (!ts) return ''
  if (typeof ts === 'string') return ts
  return ts.toDate().toISOString()
}

// ── USER PROFILE ──────────────────────────────────────────────

function isValidRole(v: unknown): v is UserProfile['role'] {
  return v === 'breeder' || v === 'owner' || v === 'admin'
}

// 'admin' is never inferable from legacy data — every account predating the
// `role` field predates the admin concept entirely, and admin access is
// gated separately by a hardcoded email allowlist (AppLayout.tsx), never by
// this field. Legacy fallback is deliberately restricted to the two values
// it could plausibly have meant.
function isValidLegacyRole(v: unknown): v is 'breeder' | 'owner' {
  return v === 'breeder' || v === 'owner'
}

// Each legacy source (accountType, roles[]) is evaluated independently into
// one of three states — this distinction (not just "valid or not") is the
// whole point: a source that's ABSENT (field never set) lets a sibling
// source stand on its own, but a source that's PRESENT-but-MALFORMED voids
// the entire legacy fallback, even if the sibling looks perfectly clean.
// Without this distinction, e.g. accountType=123 (present, garbage) +
// roles=['breeder'] (clean) would let roles win on its own — but a
// malformed accountType is exactly the kind of corrupted/tampered data this
// whole fallback exists to be defensive against, so its mere presence must
// cast doubt on the entire legacy signal, not just itself.
type LegacySourceResult =
  | { status: 'absent' }
  | { status: 'malformed' }
  | { status: 'valid'; role: 'breeder' | 'owner' }

function evaluateAccountType(raw: any): LegacySourceResult {
  if (raw.accountType === undefined) return { status: 'absent' }
  return isValidLegacyRole(raw.accountType)
    ? { status: 'valid', role: raw.accountType }
    : { status: 'malformed' }
}

// A `roles` array is malformed if: the field is present but isn't an array,
// is an empty array, contains any element that isn't a recognized legacy
// role (wrong type, unrecognized string, null, plain object, etc.), or its
// valid-looking entries don't all agree with each other. Deliberately does
// NOT filter out bad entries before checking — ['breeder', 123] is
// malformed as a whole, not "breeder with one ignored garbage entry".
function evaluateRolesArray(raw: any): LegacySourceResult {
  if (raw.roles === undefined) return { status: 'absent' }
  const roles = raw.roles
  if (!Array.isArray(roles) || roles.length === 0) return { status: 'malformed' }
  if (!roles.every(isValidLegacyRole)) return { status: 'malformed' }
  const distinct = new Set(roles)
  return distinct.size === 1 ? { status: 'valid', role: [...distinct][0] } : { status: 'malformed' }
}

// `role` is the single canonical field going forward. Some accounts predate
// it or were hand-edited via the Firebase console using an older field name
// — `accountType` (string) or `roles` (array) — so those are read here as
// fallbacks ONLY, never written back under their old name.
//
// Precedence, most to least authoritative:
//   1. A valid canonical `role` ('breeder'/'owner'/'admin') is authoritative
//      — used as-is even if legacy fields disagree with it or are malformed.
//   2. Canonical missing or invalid falls through to legacy evaluation. An
//      invalid canonical value is discarded outright; its mere presence
//      must never itself grant breeder access.
//   3. Either legacy source being PRESENT-but-MALFORMED voids the entire
//      legacy fallback — even if the other source looks perfectly clean.
//   4. Both sources present and valid must agree; if they disagree, that's
//      a genuine conflict — owner.
//   5. Exactly one source present-and-valid, the other genuinely ABSENT
//      (never set at all) — honor the one that's there, including
//      granting 'breeder'. This is the actual case legacy fallback exists
//      for: a genuinely pre-existing breeder account hand-edited before
//      `role` existed should still resolve correctly.
//   6. Nothing usable anywhere (both absent, or either malformed, or
//      valid-but-conflicting) defaults to 'owner' — deliberately the safe,
//      non-privileged role, never 'breeder'.
function normalizeUserProfile(raw: any): UserProfile {
  if (isValidRole(raw.role)) {
    return { ...raw, role: raw.role }
  }

  const accountTypeResult = evaluateAccountType(raw)
  const rolesArrayResult = evaluateRolesArray(raw)

  if (accountTypeResult.status === 'malformed' || rolesArrayResult.status === 'malformed') {
    return { ...raw, role: 'owner' }
  }

  if (accountTypeResult.status === 'valid' && rolesArrayResult.status === 'valid') {
    return { ...raw, role: accountTypeResult.role === rolesArrayResult.role ? accountTypeResult.role : 'owner' }
  }

  const soleValid = accountTypeResult.status === 'valid' ? accountTypeResult
    : rolesArrayResult.status === 'valid' ? rolesArrayResult
    : null
  return { ...raw, role: soleValid?.role ?? 'owner' }
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', userId))
  if (!snap.exists()) return null
  const d = snap.data()
  return normalizeUserProfile({ ...d, uid: snap.id, createdAt: toDate(d.createdAt) })
}

export async function createUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 30)
  await setDoc(doc(db, 'users', userId), {
    ...data,
    uid: userId,
    role: data.role || 'breeder',
    plan: 'trial',
    trialEndsAt: trialEnd.toISOString(),
    createdAt: serverTimestamp(),
  })
}

// Uses setDoc(..., {merge: true}) rather than updateDoc() — updateDoc()
// carries an implicit currentDocument:{exists:true} precondition that,
// against the real Firestore backend (not the emulator), silently failed
// to persist users/{uid} writes (role/reminderDays/state changes all
// accepted with no error but never actually took effect). setDoc merge
// produces the same partial-field-merge result via a different write RPC
// shape without that precondition.
//
// Role changes specifically get a read-back verification: a role switch
// that silently doesn't stick (whatever the underlying cause) is exactly
// the failure mode this project has hit before with Firestore writes that
// throw nothing yet never take effect. Callers (SettingsPage's changeRole)
// already catch and toast on a thrown error, so this turns a confusing
// silent no-op into a visible, honest failure instead of a false "success".
export async function updateUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  await setDoc(doc(db, 'users', userId), { ...data, updatedAt: serverTimestamp() }, { merge: true })
  if (data.role) {
    const confirm = await getDoc(doc(db, 'users', userId))
    if (confirm.data()?.role !== data.role) {
      throw new Error('ROLE_UPDATE_NOT_PERSISTED')
    }
  }
}

export async function deleteUserData(userId: string): Promise<void> {
  // 1. Collect all dog IDs for this tenant
  const dogSnap = await getDocs(query(collection(db, 'dogs'), where('tenantId', '==', userId)))
  const dogIds = dogSnap.docs.map(d => d.id)

  // 2. Delete all per-dog records across linked collections
  const perDogCols = ['vaccineRecords', 'wormingRecords', 'healthTests', 'reminders', 'activityNotes', 'documents']
  for (const dogId of dogIds) {
    for (const col of perDogCols) {
      const snap = await getDocs(query(collection(db, col), where('dogId', '==', dogId)))
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
    }
  }

  // 3. Delete dog documents
  await Promise.all(dogSnap.docs.map(d => deleteDoc(d.ref)))

  // 4. Delete tenant-level collections
  for (const col of ['litters', 'auditLogs']) {
    const snap = await getDocs(query(collection(db, col), where('tenantId', '==', userId)))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  }

  // 5. Delete user profile document
  await deleteDoc(doc(db, 'users', userId))
}

// ── DOGS ──────────────────────────────────────────────────────

// Read-time-only normalisation (ADR-001) — never writes back to Firestore.
// Every dog created before sourceType/createdByUserId existed only ever
// came from the breeder-shaped creation flow, so absence of sourceType is
// safely and unambiguously BREEDER_ISSUED, never an unknown/misclassified
// state. Shared by every place a raw Firestore snapshot becomes a Dog
// (getDog, getDogs, getDogByPassportId) so they cannot diverge.
function normalizeDog(raw: Dog): Dog {
  return {
    ...raw,
    sourceType: raw.sourceType ?? 'BREEDER_ISSUED',
    createdByUserId: raw.createdByUserId ?? raw.tenantId,
  }
}

// Codex round 13: getDogs() briefly (round 12) used Promise.allSettled so
// a transient failure on ONE of the two ownership queries wouldn't blank
// the whole list — well-intentioned, but it meant a caller who only
// checks `dogs.length === 0` (or filters for an eligible Sire/Dam) had NO
// way to tell "genuinely zero dogs" apart from "half the data failed to
// load" — a PARTIAL array presented itself as a perfectly normal COMPLETE
// one. That's worse than the outage it was trying to soften: a real dog
// silently missing from My Dogs or a selector, with no error shown
// anywhere, is exactly the class of bug this whole round exists to fix.
// Threading a typed "was this partial?" result through the ~14 different
// call sites across this app (My Dogs, both breeding selectors, sidebar
// counts, reminders, reports, buyers, documents, exports — see git log
// for the round-13 report's full consumer audit) would be the "correct"
// fix, but doing that safely for every one of them in one pass is a much
// larger, riskier change than this round's actual scope. Reverting to
// Promise.all (fail-closed) is the safe choice: every consumer that
// already existed before round 12 was written assuming getDogs() either
// resolves with the FULL list or rejects — this restores exactly that
// contract, so those call sites' existing error handling is correct
// again without needing to touch them.
export class GetDogsError extends Error {
  constructor(message = 'Failed to load dogs. Please try again.') {
    super(message)
    this.name = 'GetDogsError'
  }
}

// Codex round 15: aggregate loaders below (getAllDocumentsForUser,
// getReminders, getAllRemindersForUser, getAllPendingReminders) fan out
// into multiple subordinate Firestore queries. Round 14 fixed getDogs()
// itself; this round closes the same class of bug one layer up — a
// subordinate query failing must never let the AGGREGATE quietly resolve
// with a partial/short result indistinguishable from a genuinely
// complete one.
export class GetDocumentsError extends Error {
  constructor(message = 'Failed to load documents. Please try again.') {
    super(message)
    this.name = 'GetDocumentsError'
  }
}
export class GetRemindersError extends Error {
  constructor(message = 'Failed to load reminders. Please try again.') {
    super(message)
    this.name = 'GetRemindersError'
  }
}

// Codex round 14: browser console logs are visible to anyone with devtools
// open (or a browser extension reading console output), so the raw
// Firestore error — which can carry query/index paths, project details, or
// other internal structure — must never reach console.error/log verbatim.
// Only a fixed operation name plus a normalized, allowlisted code may be
// logged. `err.code` is read AT MOST ONCE, inside try/catch, so a hostile
// or malformed error (throwing getter, Proxy, Symbol, plain object with a
// non-string `code`, etc.) can never crash this sanitizer or leak anything
// beyond the fixed 'unknown' fallback.
const KNOWN_FIRESTORE_ERROR_CODES = new Set([
  'permission-denied', 'unavailable', 'cancelled', 'deadline-exceeded',
  'not-found', 'already-exists', 'resource-exhausted', 'failed-precondition',
  'aborted', 'out-of-range', 'unimplemented', 'internal', 'unauthenticated',
  'invalid-argument', 'unknown',
])

export function safeReadFirestoreErrorCode(err: unknown): string {
  try {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: unknown }).code
      if (typeof code === 'string' && KNOWN_FIRESTORE_ERROR_CODES.has(code)) {
        return code
      }
    }
  } catch {
    // Reading `code` itself threw (hostile getter/proxy) — fall through
    // to the fixed 'unknown' value below.
  }
  return 'unknown'
}

export async function getDogs(): Promise<Dog[]> {
  const currentUid = uid()
  if (!currentUid) return []

  let breederSnap, ownerSnap
  try {
    [breederSnap, ownerSnap] = await Promise.all([
      getDocs(query(collection(db, 'dogs'), where('tenantId', '==', currentUid))),
      getDocs(query(collection(db, 'dogs'), where('currentOwnerId', '==', currentUid)))
    ])
  } catch (err) {
    // Codex round 14: neither the console log nor the thrown error may
    // carry the raw Firestore error — only a fixed operation name plus a
    // normalized, allowlisted code goes to the console; the THROWN error
    // is always the same fixed, sanitized message.
    console.error('getDogs: load failed', { code: safeReadFirestoreErrorCode(err) })
    throw new GetDogsError()
  }

  const dogMap = new Map<string, Dog>()

  breederSnap.docs.forEach(d => {
    dogMap.set(d.id, normalizeDog({ ...d.data(), id: d.id } as Dog))
  })
  ownerSnap.docs.forEach(d => {
    dogMap.set(d.id, normalizeDog({ ...d.data(), id: d.id } as Dog))
  })

  return Array.from(dogMap.values()).map(dog => {
    // If the current user is the breeder (tenantId) but not the current owner,
    // they should see the dog as "transferred" regardless of its actual DB status
    // (which might have been set to 'active' when the new owner claimed it).
    if (dog.tenantId === currentUid && dog.currentOwnerId !== currentUid) {
      return { ...dog, status: 'transferred' }
    }
    return dog
  })
}

// Production-verified ownership check (currentOwnerId is the source of
// truth, not status alone — status resets to 'active' once a buyer claims
// a dog). Used where a dog is fetched individually via getDog() rather
// than through getDogs()'s list-level status override above — e.g. a
// reminder document can still carry the original breeder's tenantId for a
// short window after claim (until the next vaccine save or cron run
// reassigns it), so this catches that gap even when dog.status already
// looks correct. A dog with no currentOwnerId is a legacy record
// predating this field, so it falls back to whoever's asking.
export function isCurrentOwner(dog: Pick<Dog, 'currentOwnerId'>, userId: string): boolean {
  return !dog.currentOwnerId || dog.currentOwnerId === userId
}

export async function getDog(id: string): Promise<Dog | null> {
  const snap = await getDoc(doc(db, 'dogs', id))
  if (!snap.exists()) return null
  const dog = normalizeDog({ ...snap.data(), id: snap.id } as Dog)

  const currentUid = uid()
  if (dog.tenantId === currentUid && dog.currentOwnerId !== currentUid) {
    dog.status = 'transferred'
  }

  return dog
}

export async function getDogByPassportId(passportId: string): Promise<Dog | null> {
  const q = query(collection(db, 'dogs'), where('passportId', '==', passportId))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return normalizeDog({ ...d.data(), id: d.id } as Dog)
}

// ADR-002 Phase C1 — passportId uniqueness. `dogs` documents use a
// Firestore auto-generated ID, so passportId (a separate string field)
// has no built-in uniqueness guarantee. `passportReservations/{passportId}`
// is a dedicated index collection — its document ID IS the passportId —
// used purely to atomically claim a candidate before it's written onto
// any dog. A Firestore transaction's read-then-write is atomic against
// concurrent transactions touching the same document, so two callers
// racing on the exact same candidate can never both succeed: one wins
// the reservation, the other's transaction throws and retries with a
// fresh candidate. Bounded at MAX_PASSPORT_ID_ATTEMPTS — with a 32-char
// alphabet and 4-char suffix (~1M combinations per name+year cohort),
// exhausting every attempt on genuine collisions is not expected in
// practice; a persistent failure past the bound surfaces as a thrown
// error rather than silently reusing an existing ID.
const MAX_PASSPORT_ID_ATTEMPTS = 5

async function reservePassportId(namePart: string, yearPart: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_PASSPORT_ID_ATTEMPTS; attempt++) {
    const candidate = `${namePart}-${yearPart}-${nanoid(4)}`
    const reservationRef = doc(db, 'passportReservations', candidate)
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef)
        if (snap.exists()) throw new Error('PASSPORT_ID_TAKEN')
        tx.set(reservationRef, { createdAt: serverTimestamp(), createdBy: uid() })
      })
      return candidate
    } catch (err: any) {
      if (err?.message !== 'PASSPORT_ID_TAKEN') throw err
      // else: genuine collision on this specific candidate — loop and
      // try a fresh one, up to the bound above.
    }
  }
  throw new Error('Could not generate a unique passport ID — please try again')
}

// sourceType defaults to BREEDER_ISSUED so LittersPage.tsx's puppy-add
// flow (and any other caller that doesn't pass one) is unaffected. Only
// DogNewPage.tsx passes 'OWNER_CREATED' explicitly, for the pet-owner
// creation flow (ADR-001 Phase 2). IMPORTED is intentionally not part of
// this parameter's type yet — not exposed until that flow exists.
// tenantId/currentOwnerId/createdByUserId are always derived from the
// authenticated session (uid()) — never accepted from the caller — so
// there is no way for a caller to assign ownership to another user.
export async function createDog(
  data: DogFormData,
  sourceType: 'BREEDER_ISSUED' | 'OWNER_CREATED' = 'BREEDER_ISSUED'
): Promise<string> {
  const now = new Date()
  const yearPart = data.dateOfBirth ? data.dateOfBirth.slice(0, 4) : now.getFullYear().toString()
  const namePart = (data.name || 'DOG').slice(0, 3).toUpperCase()
  const passportId = await reservePassportId(namePart, yearPart)
  const ref = await addDoc(collection(db, 'dogs'), {
    ...data,
    tenantId: uid(),
    currentOwnerId: uid(),
    createdByUserId: uid(),
    sourceType,
    // originBreederId is breeder provenance — omitted for owner-created
    // dogs rather than written as a meaningless copy of tenantId.
    ...(sourceType === 'BREEDER_ISSUED' ? { originBreederId: uid() } : {}),
    passportId,
    lifeStage: calculateLifeStage(data.dateOfBirth, data.breed),
    isDeceased: false,
    photos: [],
    notes: data.notes || '',
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

// Codex round 3, Blocker 3, then moved server-side + hardened in Codex
// round 4, Blockers 3 + 4.
//
// Round 3's version ran as a CLIENT-side Firestore transaction ending in
// a direct `tx.update(litterRef, {puppyIds: arrayUnion(dogId)})` write —
// but round 4, Blocker 3 requires firestore.rules to deny ALL direct
// client litters update/delete unconditionally (see that rule's own
// comment), which a client transaction touching litters can no longer
// satisfy. This now calls api/create-litter-puppy.js (Admin SDK,
// bypasses Rules) instead.
//
// Round 4, Blocker 4 also hardened the idempotency contract itself: an
// existing dogId is no longer, by itself, treated as proof of a valid
// retry (a stale ref reused across litters, or a dogId collision with
// an unrelated dog, could otherwise silently succeed against the wrong
// record). The caller here still pre-generates and persists BOTH
// `dogId` and a separate `operationId` across retries of the same
// logical "add this puppy" submission (see LittersPage's
// pendingPuppyOperationRef) — the server endpoint persists an
// operations record keyed by operationId atomically with the dog it
// creates, and only trusts a retry when every field of that record
// (tenant, litter, dogId, and the full submitted payload) agrees with
// the new request; any mismatch fails with no writes at all rather than
// silently resuming the wrong operation.
export async function createLitterPuppyAtomic(
  litterId: string,
  dogId: string,
  operationId: string,
  data: DogFormData,
  sourceType: 'BREEDER_ISSUED' | 'OWNER_CREATED' = 'BREEDER_ISSUED'
): Promise<{ dogId: string; passportId: string; alreadyExisted: boolean }> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/create-litter-puppy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      operationId,
      litterId,
      dogId,
      sourceType,
      payload: {
        name: data.name,
        breed: data.breed,
        sex: data.sex,
        dateOfBirth: data.dateOfBirth,
        colour: data.colour,
        microchip: data.microchip,
        ankc: data.ankc,
        notes: data.notes,
      },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Add puppy failed (${res.status})`)
  }
  const result = await res.json()
  return { dogId: result.dogId, passportId: result.passportId, alreadyExisted: result.alreadyExisted }
}

export async function updateDog(id: string, data: Partial<Dog>): Promise<void> {
  await updateDoc(doc(db, 'dogs', id), { ...data, updatedAt: serverTimestamp() })
}

/**
 * Re-calculates a dog's life stage from its current age and breed, and
 * if it differs from what's stored, updates Firestore and writes an
 * audit entry recording the transition (e.g. "puppy → adult"). This is
 * how lifeStage stays accurate over time without needing a separate
 * cron job — dogs were previously stuck at whatever lifeStage they were
 * created with ('puppy'), since nothing ever updated it afterwards.
 *
 * Call this once when a dog's detail page loads (not from list views,
 * to avoid an unnecessary Firestore write/read + audit log entry every
 * time the user just glances at their dog list).
 *
 * Returns the up-to-date life stage so the caller can immediately
 * reflect it in local state without waiting for a re-fetch.
 */
export async function syncLifeStage(dog: Dog): Promise<LifeStage> {
  if (dog.isDeceased) return 'remembered' // deceased dogs are always "Forever", regardless of age math
  const calculated = calculateLifeStage(dog.dateOfBirth, dog.breed)
  if (calculated === dog.lifeStage) return dog.lifeStage // already correct, nothing to do

  try {
    await updateDog(dog.id, { lifeStage: calculated })
    await logAudit({
      tenantId: dog.tenantId,
      dogId: dog.id,
      dogName: dog.name,
      action: 'life_stage_changed',
      details: `Life stage updated: ${LIFE_STAGE_LABELS[dog.lifeStage]} → ${LIFE_STAGE_LABELS[calculated]}`,
      performedBy: 'system',
      performedByEmail: 'system@idogs.com.au',
    })
  } catch (err) {
    console.error('Failed to sync life stage:', err)
    return dog.lifeStage // if the write fails, don't claim the new stage took effect
  }

  return calculated
}

export async function deleteDog(id: string): Promise<void> {
  await deleteDoc(doc(db, 'dogs', id))
}

// ── OWNERSHIP TRANSFER ────────────────────────────────────────

export async function transferDogOwnership(
  dogId: string,
  transfer: {
    buyerName: string
    buyerEmail: string
    buyerPhone?: string
    transferredAt: string
    microchipCertUrl?: string | null
  }
): Promise<void> {
  await updateDoc(doc(db, 'dogs', dogId), {
    status: 'transferred',
    transferStatus: 'pendingClaim',
    previousOwnerId: uid(),
    buyerName: transfer.buyerName,
    buyerEmail: transfer.buyerEmail.trim().toLowerCase(),
    ...(transfer.buyerPhone ? { buyerPhone: transfer.buyerPhone } : {}),
    transferredAt: transfer.transferredAt,
    ...(transfer.microchipCertUrl ? { microchipCertUrl: transfer.microchipCertUrl } : {}),
    updatedAt: serverTimestamp(),
  })
}

export async function getDogsByBuyerEmail(email: string): Promise<Dog[]> {
  const q = query(collection(db, 'dogs'), where('buyerEmail', '==', email.toLowerCase()))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Dog))
}

// Call once after buyer creates account — reassigns transferred dogs to
// their uid. Routed through /api/claim-transferred-dogs (server-side,
// Admin SDK) rather than writing directly here, because firestore.rules
// correctly blocks a buyer from reading/updating a dog they don't own
// yet — that's exactly the gap this claim operation needs to cross, so
// it has to happen server-side with the buyer's identity verified via
// their Firebase ID token instead of a client-supplied email/uid.
// IMPORTANT: this function does NOT swallow failures into a silent 0/[]
// (it used to — an API error was indistinguishable from "no pending
// dogs", which is exactly why /app/claim-dogs was showing "No pending
// transfers" for a buyer whose dog was confirmed sitting in Firestore
// with the correct buyerEmail/transferStatus). Any real failure — bad
// token, network error, non-2xx response — now throws so the caller can
// tell the user what actually happened instead of a misleading empty
// result. Callers that want to fail silently (e.g. a background banner
// check) should catch this themselves, same as AppLayout.tsx already does.
export async function claimTransferredDogs(_userId: string, _email: string, action: 'check' | 'claim' = 'claim'): Promise<any> {
  if (!auth.currentUser) {
    if (action === 'check') return []
    throw new Error('Not signed in')
  }
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/claim-transferred-dogs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Claim request failed (${res.status})`)
  }
  const data = await res.json()
  if (action === 'check') return data.dogs || []
  return data.claimed || 0
}

// ── VACCINE RECORDS ───────────────────────────────────────────

export async function getVaccineRecords(dogId: string): Promise<VaccineRecord[]> {
  const q = query(
    collection(db, 'vaccineRecords'),
    where('dogId', '==', dogId)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as VaccineRecord))
}

export async function addVaccineRecord(data: Omit<VaccineRecord, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'vaccineRecords'), {
    ...data,
    createdAt: serverTimestamp(),
  })
  if (data.nextDue) {
    await upsertVaccineReminder(data.dogId, ref.id, { name: data.name, nextDue: data.nextDue })
  }
  return ref.id
}

export async function updateVaccineRecord(id: string, data: Partial<VaccineRecord>): Promise<void> {
  await updateDoc(doc(db, 'vaccineRecords', id), data)
  const snap = await getDoc(doc(db, 'vaccineRecords', id))
  if (snap.exists()) {
    const v = snap.data() as VaccineRecord
    if (v.nextDue) await upsertVaccineReminder(v.dogId, id, { name: v.name, nextDue: v.nextDue })
  }
}

export async function deleteVaccineRecord(id: string): Promise<void> {
  await deleteDoc(doc(db, 'vaccineRecords', id))
}

// ── WORMING RECORDS ───────────────────────────────────────────

export async function getWormingRecords(dogId: string): Promise<WormingRecord[]> {
  const q = query(
    collection(db, 'wormingRecords'),
    where('dogId', '==', dogId)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as WormingRecord))
}

export async function addWormingRecord(data: Omit<WormingRecord, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'wormingRecords'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteWormingRecord(id: string): Promise<void> {
  await deleteDoc(doc(db, 'wormingRecords', id))
}

// ── HEALTH TESTS ──────────────────────────────────────────────

export async function getHealthTests(dogId: string): Promise<HealthTest[]> {
  const q = query(collection(db, 'healthTests'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as HealthTest))
}

export async function addHealthTest(data: Omit<HealthTest, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'healthTests'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function updateHealthTest(id: string, data: Partial<HealthTest>): Promise<void> {
  await updateDoc(doc(db, 'healthTests', id), data)
}

export async function deleteHealthTest(id: string): Promise<void> {
  await deleteDoc(doc(db, 'healthTests', id))
}

// ── REMINDERS ─────────────────────────────────────────────────

// Creates/refreshes the reminder for a single vaccine record the moment
// it's saved, so it shows up in the Reminders tab immediately instead of
// waiting for the next daily cron run (api/send-reminders.js only
// upserts reminders once a day — a vaccine added minutes after that run
// previously stayed invisible for up to ~24h).
//
// Uses the exact same deterministic id (`vaccine_${dogId}_${vaccineId}`)
// and owner-resolution rule (currentOwnerId, falling back to tenantId)
// that the cron uses, so this is a true upsert — whichever side writes
// last just refreshes the same doc, never creates a duplicate — and it
// inherits Fix Batch G's ownership behaviour: a pendingClaim dog gets no
// reminder yet, and a claimed dog's reminder is owned by the new owner,
// not the original breeder.
async function upsertVaccineReminder(
  dogId: string,
  vaccineId: string,
  vaccine: { name: string; nextDue: string }
): Promise<void> {
  try {
    const dogSnap = await getDoc(doc(db, 'dogs', dogId))
    if (!dogSnap.exists()) return
    const dog = dogSnap.data() as Dog
    if (dog.status === 'transferred') return // pendingClaim — no active owner yet
    const ownerId = dog.currentOwnerId || dog.tenantId
    if (!ownerId) return

    const reminderId = `vaccine_${dogId}_${vaccineId}`
    const reminderRef = doc(db, 'reminders', reminderId)
    const existing = await getDoc(reminderRef)
    if (existing.exists() && existing.data()?.status === 'completed') return

    const daysUntilDue = Math.ceil((new Date(vaccine.nextDue).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    const dueLabel = daysUntilDue < 0
      ? `overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? 's' : ''}`
      : daysUntilDue === 0 ? 'today'
      : daysUntilDue === 1 ? 'tomorrow'
      : `in ${daysUntilDue} days`

    await setDoc(reminderRef, {
      id: reminderId,
      dogId,
      tenantId: ownerId,
      title: `${vaccine.name} due ${dueLabel}`,
      dueDate: vaccine.nextDue,
      type: 'vaccine',
      vaccineId,
      status: daysUntilDue < 0 ? 'overdue' : 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true })
  } catch (err) {
    console.error('Failed to upsert vaccine reminder:', err)
  }
}

// Per-dog reminders (used in DogDetailPage). Always runs the tenantId-scoped
// query first — a dogId-only query can't satisfy the tenant-scoped `list`
// rule on the reminders collection in production, since Firestore must be
// able to prove the rule holds from the query's own where-clauses alone,
// not from inspecting matched documents; a dogId-only query is denied
// outright. The optional `dog` param mirrors the claimed-dog merge already
// used by getAllRemindersForUser() below: when the caller is the dog's
// current owner via a claim rather than the original tenant, a claimed
// dog's older reminder doc still carries the original breeder's tenantId
// until the next vaccine save or cron run reassigns it, so a second,
// best-effort dogId-only query is attempted to catch that case. That query
// has no tenantId filter, so it's expected to be denied by the same list
// rule once the reminder's tenantId hasn't been reassigned yet in a
// stricter rule environment — wrapped so a deny there doesn't discard the
// tenantReminders that already loaded successfully.
export async function getReminders(
  dogId: string,
  userId: string,
  dog?: Pick<Dog, 'tenantId' | 'currentOwnerId'>
): Promise<Reminder[]> {
  const tenantSnap = await getDocs(
    query(collection(db, 'reminders'), where('dogId', '==', dogId), where('tenantId', '==', userId))
  )
  const tenantReminders = tenantSnap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))

  const isClaimedByCaller = !!dog && dog.currentOwnerId === userId && dog.tenantId !== userId
  if (!isClaimedByCaller) return tenantReminders

  // Codex round 15: distinguish an EXPECTED deny from a genuine failure.
  // permission-denied here is a documented, by-design outcome — the
  // reminders collection's tenant-scoped `list` rule denies this
  // dogId-only query until the next vaccine edit or daily cron job
  // reassigns tenantId to the new owner, which is true for every
  // freshly-claimed dog, not just ones hitting a real outage. Silently
  // treating THAT as "zero claimed reminders" is correct — it's not a
  // failure being swallowed, it's an accurately-interpreted deny. Any
  // OTHER code (unavailable, deadline-exceeded, resource-exhausted,
  // unknown, ...) means we genuinely don't know whether claimed
  // reminders exist, so — unlike the permission-denied case — that must
  // reject the whole call rather than silently present as "none".
  let claimedReminders: Reminder[] = []
  try {
    const claimedSnap = await getDocs(query(collection(db, 'reminders'), where('dogId', '==', dogId)))
    claimedReminders = claimedSnap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
  } catch (err) {
    const code = safeReadFirestoreErrorCode(err)
    if (code !== 'permission-denied') {
      console.error('getReminders: claimed-dog reminder query failed', { code })
      throw new GetRemindersError()
    }
  }

  const merged = new Map<string, Reminder>()
  for (const r of [...tenantReminders, ...claimedReminders]) merged.set(r.id, r)
  return Array.from(merged.values())
}

// All reminders for current user across all dogs (used in RemindersPage).
// Cross-checked against getDogs() (same pattern as getAllPendingReminders
// below) so a dog the user has transferred away drops out immediately —
// the reminders collection itself still tags old docs with the original
// breeder's tenantId until the next cron run reassigns them. getDogs()
// already overrides status to 'transferred' for a former breeder, so this
// filter is correct without needing a separate currentOwnerId check here.
export async function getAllRemindersForUser(userId: string): Promise<Reminder[]> {
  const [snap, dogs] = await Promise.all([
    getDocs(query(collection(db, 'reminders'), where('tenantId', '==', userId))),
    getDogs(),
  ])
  const ownedDogIds = new Set(dogs.filter(d => d.status !== 'transferred').map(d => d.id))
  const tenantReminders = snap.docs
    .map(d => ({ ...d.data(), id: d.id } as Reminder))
    .filter(r => ownedDogIds.has(r.dogId))

  // A claimed dog's reminder doc keeps the original breeder's tenantId
  // until the next vaccine save or daily cron run reassigns it — this
  // query attempts to find those anyway so a buyer sees a claimed dog's
  // reminders immediately, without waiting for that reassignment. Reuses
  // the `dogs` array from getDogs() above (already includes claimed dogs
  // via the currentOwnerId union) instead of a second Firestore query.
  // (Firestore 'in' caps at 30 values — fine at this app's scale.)
  //
  // This query has no tenantId filter, so it can never satisfy the
  // tenant-scoped `list` rule on reminders in production — Firestore
  // denies it outright whenever the reminder doc's tenantId still belongs
  // to someone else, which is true for every claimed dog until that
  // reassignment happens. It's wrapped here so that expected failure
  // doesn't discard the already-valid tenantReminders above; the known
  // tradeoff is a just-claimed dog's pre-existing reminder stays invisible
  // to the new owner until their next vaccine edit or the next cron run
  // reassigns tenantId — not indefinitely, but not immediate either.
  const claimedDogIds = dogs
    .filter(d => d.currentOwnerId === userId && d.tenantId !== userId)
    .map(d => d.id)
  // Codex round 15: see the matching comment in getReminders() above —
  // permission-denied is the expected, by-design outcome until tenantId
  // reassignment and is not treated as a failure; any other code means
  // this aggregate genuinely doesn't know the claimed-reminder state and
  // must reject rather than silently present tenant-only results as if
  // they were the complete answer.
  let claimedReminders: Reminder[] = []
  if (claimedDogIds.length > 0) {
    try {
      const claimedRemindersSnap = await getDocs(
        query(collection(db, 'reminders'), where('dogId', 'in', claimedDogIds.slice(0, 30)))
      )
      claimedReminders = claimedRemindersSnap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
    } catch (err) {
      const code = safeReadFirestoreErrorCode(err)
      if (code !== 'permission-denied') {
        console.error('getAllRemindersForUser: claimed-dog reminder query failed', { code })
        throw new GetRemindersError()
      }
    }
  }

  const merged = new Map<string, Reminder>()
  for (const r of [...tenantReminders, ...claimedReminders]) merged.set(r.id, r)
  return Array.from(merged.values())
}

// Used in DashboardPage. Mirrors the claimed-dog merge in
// getAllRemindersForUser() above so a claimed dog's reminder — still
// tagged with the original breeder's tenantId until the next vaccine
// edit or cron run reassigns it — shows up on the current owner's
// Dashboard too, not just on /app/reminders and Dog Detail.
export async function getAllPendingReminders(): Promise<Reminder[]> {
  const userId = uid()
  const dogs = await getDogs()
  const dogIds = new Set(dogs.filter(d => d.status !== 'transferred').map(d => d.id))

  const tenantSnap = dogIds.size > 0
    ? await getDocs(query(collection(db, 'reminders'), where('tenantId', '==', userId)))
    : null
  const tenantReminders = (tenantSnap?.docs ?? [])
    .map(d => ({ ...d.data(), id: d.id } as Reminder))
    .filter(r => dogIds.has(r.dogId) && ['pending', 'overdue'].includes(r.status))

  const claimedDogIds = dogs
    .filter(d => d.currentOwnerId === userId && d.tenantId !== userId)
    .map(d => d.id)
  // Codex round 15: same permission-denied-is-expected distinction as
  // getReminders()/getAllRemindersForUser() above — see those comments.
  let claimedReminders: Reminder[] = []
  if (claimedDogIds.length > 0) {
    try {
      const claimedSnap = await getDocs(
        query(collection(db, 'reminders'), where('dogId', 'in', claimedDogIds.slice(0, 30)))
      )
      claimedReminders = claimedSnap.docs
        .map(d => ({ ...d.data(), id: d.id } as Reminder))
        .filter(r => ['pending', 'overdue'].includes(r.status))
    } catch (err) {
      const code = safeReadFirestoreErrorCode(err)
      if (code !== 'permission-denied') {
        console.error('getAllPendingReminders: claimed-dog reminder query failed', { code })
        throw new GetRemindersError()
      }
    }
  }

  const merged = new Map<string, Reminder>()
  for (const r of [...tenantReminders, ...claimedReminders]) merged.set(r.id, r)
  return Array.from(merged.values())
}

export async function addReminder(data: Omit<Reminder, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'reminders'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function completeReminder(id: string): Promise<void> {
  await updateDoc(doc(db, 'reminders', id), { status: 'completed', completedAt: new Date().toISOString() })
}

export async function updateReminder(id: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'reminders', id), data)
}

export async function deleteReminder(id: string): Promise<void> {
  await deleteDoc(doc(db, 'reminders', id))
}

// ── ACTIVITY NOTES ────────────────────────────────────────────

export async function getActivityNotes(dogId: string): Promise<ActivityNote[]> {
  const q = query(collection(db, 'activityNotes'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  // FIX (crash: "(l.date || '').localeCompare is not a function" when
  // building the Timeline): createdAt comes back from Firestore as a
  // Timestamp object, not a string. Other read functions (e.g.
  // getAuditLogs below) already convert this with toDate().toISOString(),
  // but this one didn't — so any code sorting/comparing ActivityNote
  // dates as strings would crash the moment a new note was added and
  // the Timeline re-rendered. Apply the same conversion here.
  return snap.docs.map(d => {
    const data = d.data()
    const createdAt = data.createdAt?.toDate?.()?.toISOString() || data.createdAt || ''
    return { ...data, id: d.id, createdAt } as ActivityNote
  })
}

export async function addActivityNote(dogId: string, note: string, photoUrl?: string, noteDate?: string): Promise<string> {
  const ref = await addDoc(collection(db, 'activityNotes'), {
    dogId, note, createdBy: uid(), createdAt: serverTimestamp(),
    // FIX (missing feature: no way to backdate an Activity Note): users
    // want to log something that happened yesterday or earlier, not just
    // "right now". createdAt stays as serverTimestamp() (true record-
    // creation time, kept for audit purposes), while noteDate — when
    // provided — is the date the EVENT actually happened, and is what
    // the Timeline should sort/display by for this note.
    ...(noteDate ? { noteDate } : {}),
    ...(photoUrl ? { photoUrl } : {}),
  })
  return ref.id
}

// ── LITTERS ───────────────────────────────────────────────────

// Excludes archived litters (Codex round 5, Blocker 2) — api/delete-litter.js
// archives rather than hard-deletes a litter whenever a preserved
// (transferred/claimed/history-bearing) Dog is still linked to it, so
// that Dog's litterId back-reference always resolves to a real document.
// The breeder's normal Litters view should still only show what's
// actually active, not litters they already "deleted" (from their own
// perspective) that happen to be preserved for someone else's lineage.
export async function getLitters(): Promise<Litter[]> {
  const q = query(collection(db, 'litters'), where('tenantId', '==', uid()))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ ...d.data(), id: d.id } as Litter))
    .filter(litter => !litter.archived)
}

// Codex round 3, Blocker 1 — litter creation must verify the Dam (and
// Sire, if set) "meets actual minimum breeding maturity", which needs
// real date arithmetic Firestore Rules has no functions for. This now
// calls api/create-litter.js (Admin SDK, full validation via
// api/_lib/parent-eligibility.js) instead of writing to Firestore
// directly — firestore.rules denies a direct client create outright, so
// this is the only path.
export async function createLitter(data: Omit<Litter, 'id' | 'createdAt' | 'tenantId'>): Promise<string> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/create-litter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Create litter failed (${res.status})`)
  }
  const result = await res.json()
  return result.litterId
}

// Codex round 4, Blocker 3 — firestore.rules now denies litters update
// unconditionally (no direct-client rule path can safely verify
// DOB-propagation to puppies happened correctly), so this calls
// api/update-litter.js (Admin SDK) instead of writing to Firestore
// directly. Only name/matingSuspectedDate/expectedDueDate/
// actualBirthDate/notes are ever meaningful here — damId/sireId/
// tenantId were never settable through this function's callers anyway.
// Returns how many still-owned, history-free puppies had their DOB
// propagated (0 when actualBirthDate wasn't part of this patch, or
// didn't actually change).
export async function updateLitter(id: string, data: Partial<Litter>): Promise<{ updatedPuppyCount: number }> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/update-litter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ litterId: id, patch: data }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Update litter failed (${res.status})`)
  }
  return res.json()
}

// Codex round 4, Blocker 3 — mirrors updateLitter()'s move server-side.
// Re-decides which puppies are safe to delete alongside the litter fresh
// inside api/delete-litter.js's own Admin SDK transaction (the exact
// same eligibility logic round 3's client transaction used, just moved
// where a direct client write can no longer bypass it).
export async function deleteLitterServer(id: string): Promise<{ deletedCount: number; preservedCount: number; ambiguousCount: number; litterDeleted: boolean; litterArchived: boolean }> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/delete-litter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ litterId: id }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Delete litter failed (${res.status})`)
  }
  return res.json()
}

// Codex round 4, Blocker 3 — replaces the old direct
// updateLitter(litter.id, {puppyIds: filtered}) call (a raw client
// puppyIds mutation, exactly the bypass this blocker calls out by name)
// with a server endpoint that verifies confirmed litter membership
// before unlinking. Unlinks only — never deletes the Dog document.
export async function removePuppyFromLitter(litterId: string, puppyId: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/remove-litter-puppy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ litterId, puppyId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Remove puppy failed (${res.status})`)
  }
}

// ── AUDIT TRAIL ──────────────────────────────────────────────

export type AuditAction =
  | 'dog_created' | 'dog_updated' | 'dog_deleted' | 'dog_transferred'
  | 'vaccine_added' | 'vaccine_deleted'
  | 'health_test_added' | 'health_test_deleted'
  | 'worming_added' | 'worming_deleted'
  | 'document_uploaded'
  | 'reminder_completed'
  | 'litter_created' | 'puppy_added'
  | 'life_stage_changed'

export interface AuditEntry {
  id: string
  tenantId: string
  dogId?: string
  dogName?: string
  action: AuditAction
  details: string
  performedBy: string
  performedByEmail?: string
  createdAt: string
}

export async function logAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      ...entry,
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    console.error('Audit log failed:', err)
  }
}

// USER-FACING: scoped to the current tenant only. After an ownership
// transfer, the dog's tenantId changes to the new owner — so this
// naturally only returns events recorded under the caller's own tenancy.
// A breeder never sees a buyer's post-transfer activity, and a buyer
// never sees the breeder's pre-transfer activity. This is intentional:
// full cross-tenant history is an admin-only concern (see
// getFullAuditHistoryForDog below), not something either party should
// see about the other in the product UI.
export async function getAuditLogs(tenantId: string, dogId?: string): Promise<AuditEntry[]> {
  const q = dogId
    ? query(collection(db, 'auditLogs'), where('tenantId', '==', tenantId), where('dogId', '==', dogId))
    : query(collection(db, 'auditLogs'), where('tenantId', '==', tenantId))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => {
      const data = d.data()
      // Handle Firestore Timestamp
      const createdAt = data.createdAt?.toDate?.()?.toISOString() || data.createdAt || ''
      return { ...data, id: d.id, createdAt } as AuditEntry
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ADMIN-ONLY: full audit history for a dog across ALL tenants it has ever
// belonged to (i.e. spanning ownership transfers). Use this for
// compliance, dispute resolution, or third-party verification requests —
// never expose this directly in the normal user-facing UI, since it
// would let a buyer see a breeder's internal activity (or vice versa).
// Gate any caller of this function behind an admin check.
export async function getFullAuditHistoryForDog(dogId: string): Promise<AuditEntry[]> {
  const q = query(collection(db, 'auditLogs'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => {
      const data = d.data()
      const createdAt = data.createdAt?.toDate?.()?.toISOString() || data.createdAt || ''
      return { ...data, id: d.id, createdAt } as AuditEntry
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ── SCAN LOG ──────────────────────────────────────────────────

export async function logScan(dogId: string, passportId: string): Promise<void> {
  await addDoc(collection(db, 'scanLogs'), {
    dogId, passportId,
    scannedAt: serverTimestamp(),
    result: 'public_view',
  })
}

export async function getDogDocuments(dogId: string): Promise<any[]> {
  const q = query(collection(db, 'documents'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a: any, b: any) => {
      const timeA = a.uploadedAt?.toDate?.()?.getTime() || 0
      const timeB = b.uploadedAt?.toDate?.()?.getTime() || 0
      return timeB - timeA
    })
}

// Derives accessible dog IDs from getDogs() (already correctly scoped to
// tenantId OR currentOwnerId, with status overridden to 'transferred' for
// a former breeder's own view) rather than querying `documents` by
// tenantId directly — a tenantId-literal query only ever matches whoever
// originally uploaded a document, so a claimed dog's pre-transfer
// documents (uploaded by the original breeder) would never surface for
// its new current owner. Fetching per-dog via getDogDocuments() reuses
// the same dogId-scoped query (and dogBelongsToUser rule) already proven
// safe and working — no rules change needed.
export async function getAllDocumentsForUser(_userId: string): Promise<any[]> {
  const dogs = await getDogs()
  const accessibleDogIds = dogs.filter(d => d.status !== 'transferred').map(d => d.id)
  if (accessibleDogIds.length === 0) return []
  // Codex round 15: previously each per-dog getDogDocuments() call was
  // individually wrapped in .catch(() => []) — one dog's query failing
  // (permission blip, network drop) silently contributed zero documents
  // for that dog while the rest resolved normally, so the aggregate
  // returned a PARTIAL list with no way for the caller to tell it apart
  // from a dog that genuinely has no documents. Promise.all (no per-item
  // catch) now means any one dog's query failing rejects the whole
  // aggregate, matching getDogs()'s own fail-closed contract.
  let perDog: any[][]
  try {
    perDog = await Promise.all(accessibleDogIds.map(id => getDogDocuments(id)))
  } catch (err) {
    console.error('getAllDocumentsForUser: load failed', { code: safeReadFirestoreErrorCode(err) })
    throw new GetDocumentsError()
  }
  return perDog.flat().sort((a: any, b: any) => {
    const timeA = a.uploadedAt?.toDate?.()?.getTime() || 0
    const timeB = b.uploadedAt?.toDate?.()?.getTime() || 0
    return timeB - timeA
  })
}

export async function deleteDocument(id: string): Promise<void> {
  await deleteDoc(doc(db, 'documents', id))
}

// ADR-002 Phase C2: scanLogs denies all client reads (see firestore.rules
// comment on that collection) — a direct client query here always failed
// permission-denied. Goes through the authenticated /api/scan-count
// endpoint instead (Admin SDK, ownership-checked, aggregate-only). Throws
// on failure rather than swallowing to 0 — same reasoning as
// claimTransferredDogs() above: a real error must never be
// indistinguishable from a genuine zero-scan dog. Callers that want a
// safe "unavailable" UI state should catch this themselves.
export async function getScanCount(dogId: string): Promise<number> {
  if (!auth.currentUser) {
    throw new Error('Not signed in')
  }
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch('/api/scan-count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ dogId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Scan count request failed (${res.status})`)
  }
  const data = await res.json()
  return typeof data.count === 'number' ? data.count : 0
}
