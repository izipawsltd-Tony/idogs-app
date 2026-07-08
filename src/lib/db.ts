import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, setDoc, Timestamp
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
    role: 'breeder',
    plan: 'trial',
    trialEndsAt: trialEnd.toISOString(),
    createdAt: serverTimestamp(),
  })
}

export async function updateUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  await updateDoc(doc(db, 'users', userId), { ...data, updatedAt: serverTimestamp() })
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

export async function getDogs(): Promise<Dog[]> {
  const currentUid = uid()
  if (!currentUid) return []
  const snap = await getDocs(query(collection(db, 'dogs'), where('tenantId', '==', currentUid)))
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Dog))
}

export async function getDog(id: string): Promise<Dog | null> {
  const snap = await getDoc(doc(db, 'dogs', id))
  if (!snap.exists()) return null
  return { ...snap.data(), id: snap.id } as Dog
}

export async function getDogByPassportId(passportId: string): Promise<Dog | null> {
  const q = query(collection(db, 'dogs'), where('passportId', '==', passportId))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return { ...d.data(), id: d.id } as Dog
}

export async function createDog(data: DogFormData): Promise<string> {
  const now = new Date()
  const yearPart = data.dateOfBirth ? data.dateOfBirth.slice(0, 4) : now.getFullYear().toString()
  const namePart = (data.name || 'DOG').slice(0, 3).toUpperCase()
  const passportId = `${namePart}-${yearPart}-${nanoid(4)}`
  const ref = await addDoc(collection(db, 'dogs'), {
    ...data,
    tenantId: uid(),
    originBreederId: uid(),
    currentOwnerId: uid(),
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
    buyerName: transfer.buyerName,
    buyerEmail: transfer.buyerEmail,
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
export async function claimTransferredDogs(_userId: string, _email: string): Promise<number> {
  if (!auth.currentUser) return 0
  try {
    const idToken = await auth.currentUser.getIdToken()
    const res = await fetch('/api/claim-transferred-dogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return 0
    const data = await res.json()
    return data.claimed || 0
  } catch {
    return 0
  }
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
  return ref.id
}

export async function updateVaccineRecord(id: string, data: Partial<VaccineRecord>): Promise<void> {
  await updateDoc(doc(db, 'vaccineRecords', id), data)
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

// Per-dog reminders (used in DogDetailPage)
export async function getReminders(dogId: string): Promise<Reminder[]> {
  const q = query(collection(db, 'reminders'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
}

// All reminders for current user across all dogs (used in RemindersPage)
export async function getAllRemindersForUser(userId: string): Promise<Reminder[]> {
  const q = query(collection(db, 'reminders'), where('tenantId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
}

// Used in DashboardPage
export async function getAllPendingReminders(): Promise<Reminder[]> {
  const dogs = await getDogs()
  const dogIds = new Set(dogs.map(d => d.id))
  if (dogIds.size === 0) return []
  const q = query(
    collection(db, 'reminders'),
    where('tenantId', '==', uid())
  )
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ ...d.data(), id: d.id } as Reminder))
    .filter(r => dogIds.has(r.dogId) && ['pending', 'overdue'].includes(r.status))
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

export async function getAllDocumentsForUser(userId: string): Promise<any[]> {
  const q = query(collection(db, 'documents'), where('tenantId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a: any, b: any) => {
      const timeA = a.uploadedAt?.toDate?.()?.getTime() || 0
      const timeB = b.uploadedAt?.toDate?.()?.getTime() || 0
      return timeB - timeA
    })
}

export async function deleteDocument(id: string): Promise<void> {
  await deleteDoc(doc(db, 'documents', id))
}

export async function getScanCount(dogId: string): Promise<number> {
  const q = query(collection(db, 'scanLogs'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  return snap.size
}
