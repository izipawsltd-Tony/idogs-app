import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, setDoc, Timestamp
} from 'firebase/firestore'
import { db, auth } from './firebase'
import type { Dog, DogFormData, VaccineRecord, WormingRecord, HealthTest, Reminder, ActivityNote, UserProfile, Litter } from '../types'
import { nanoid } from './utils'

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

// ── DOGS ──────────────────────────────────────────────────────

export async function getDogs(): Promise<Dog[]> {
  const q = query(
    collection(db, 'dogs'),
    where('tenantId', '==', uid())
  )
  const snap = await getDocs(q)
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
    lifeStage: 'puppy',
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

export async function deleteDog(id: string): Promise<void> {
  await deleteDoc(doc(db, 'dogs', id))
}

// ── OWNERSHIP TRANSFER ────────────────────────────────────────

export async function transferDogOwnership(
  dogId: string,
  transfer: {
    buyerName: string
    buyerEmail: string
    transferredAt: string
    microchipCertUrl?: string | null
  }
): Promise<void> {
  await updateDoc(doc(db, 'dogs', dogId), {
    status: 'transferred',
    buyerName: transfer.buyerName,
    buyerEmail: transfer.buyerEmail,
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

// Call once after buyer creates account — reassigns transferred dogs to their uid
export async function claimTransferredDogs(userId: string, email: string): Promise<number> {
  const dogs = await getDogsByBuyerEmail(email)
  const transferredDogs = dogs.filter((d: any) => d.status === 'transferred')
  await Promise.all(
    transferredDogs.map((d: any) =>
      updateDoc(doc(db, 'dogs', d.id), {
        tenantId: userId,
        currentOwnerId: userId,
        status: 'active',
        claimedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      })
    )
  )
  return transferredDogs.length
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
    where('status', 'in', ['pending', 'overdue'])
  )
  const snap = await getDocs(q)
  const allReminders = snap.docs.map(d => ({ ...d.data(), id: d.id } as Reminder))
  return allReminders.filter(r => dogIds.has(r.dogId))
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
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as ActivityNote))
}

export async function addActivityNote(dogId: string, note: string): Promise<string> {
  const ref = await addDoc(collection(db, 'activityNotes'), {
    dogId, note, createdBy: uid(), createdAt: serverTimestamp()
  })
  return ref.id
}

// ── LITTERS ───────────────────────────────────────────────────

export async function getLitters(): Promise<Litter[]> {
  const q = query(collection(db, 'litters'), where('tenantId', '==', uid()))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Litter))
}

export async function createLitter(data: Omit<Litter, 'id' | 'createdAt'>): Promise<string> {
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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getAllDocumentsForUser(userId: string): Promise<any[]> {
  const q = query(collection(db, 'documents'), where('tenantId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function getScanCount(dogId: string): Promise<number> {
  const q = query(collection(db, 'scanLogs'), where('dogId', '==', dogId))
  const snap = await getDocs(q)
  return snap.size
}
