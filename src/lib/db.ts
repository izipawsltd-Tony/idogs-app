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

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', userId))
  if (!snap.exists()) return null
  const d = snap.data()
  return { ...d, uid: snap.id, createdAt: toDate(d.createdAt) } as UserProfile
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
export async function updateUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  await setDoc(doc(db, 'users', userId), { ...data, updatedAt: serverTimestamp() }, { merge: true })
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

export async function getDogs(): Promise<Dog[]> {
  const currentUid = uid()
  if (!currentUid) return []

  const [breederSnap, ownerSnap] = await Promise.all([
    getDocs(query(collection(db, 'dogs'), where('tenantId', '==', currentUid))),
    getDocs(query(collection(db, 'dogs'), where('currentOwnerId', '==', currentUid)))
  ])

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

  let claimedReminders: Reminder[] = []
  try {
    const claimedSnap = await getDocs(query(collection(db, 'reminders'), where('dogId', '==', dogId)))
    claimedReminders = claimedSnap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
  } catch (err) {
    console.error('Failed to fetch claimed-dog reminders for dog detail (expected until tenantId reassignment):', err)
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
  let claimedReminders: Reminder[] = []
  if (claimedDogIds.length > 0) {
    try {
      const claimedRemindersSnap = await getDocs(
        query(collection(db, 'reminders'), where('dogId', 'in', claimedDogIds.slice(0, 30)))
      )
      claimedReminders = claimedRemindersSnap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
    } catch (err) {
      console.error('Failed to fetch claimed-dog reminders (expected until tenantId reassignment):', err)
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
      console.error('Failed to fetch claimed-dog pending reminders (expected until tenantId reassignment):', err)
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

export async function getLitters(): Promise<Litter[]> {
  const q = query(collection(db, 'litters'), where('tenantId', '==', uid()))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Litter))
}

export async function createLitter(data: Omit<Litter, 'id' | 'createdAt' | 'tenantId'>): Promise<string> {
  const ref = await addDoc(collection(db, 'litters'), { ...data, tenantId: uid(), createdAt: serverTimestamp() })
  return ref.id
}

export async function updateLitter(id: string, data: Partial<Litter>): Promise<void> {
  await updateDoc(doc(db, 'litters', id), data)
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
  const perDog = await Promise.all(accessibleDogIds.map(id => getDogDocuments(id).catch(() => [])))
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
