// ── CORE DOMAIN TYPES ──────────────────────────────────────────

export type LifeStage = 'whelp' | 'puppy' | 'young_adult' | 'adult' | 'senior' | 'remembered'

export type Sex = 'male' | 'female'

export interface Dog {
  id: string
  tenantId: string
  passportId: string
  name: string
  breed: string
  sex: Sex
  dateOfBirth: string
  colour: string
  microchip: string
  ankc: string
  lifeStage: LifeStage
  isDeceased: boolean
  originBreederId: string
  currentOwnerId: string
  // Dog Origin & Provenance (ADR-001). Optional so legacy documents with
  // neither field remain valid — see normalizeDog() in db.ts for the
  // read-time BREEDER_ISSUED fallback. Never reassigned by transfer/claim,
  // same immutability contract as tenantId.
  sourceType?: 'BREEDER_ISSUED' | 'OWNER_CREATED' | 'IMPORTED'
  createdByUserId?: string
  profilePhoto?: string
  photos: string[]
  notes: string
  // State-issued Breeder ID (per the NSW Puppy Farming Act 2024 and
  // equivalent VIC/QLD/SA/ACT laws) — a generic field rather than 8
  // state-specific ones, since a breeder only has one Breeder ID tied to
  // where they're registered, regardless of which state the buyer is in.
  // 'NONE' covers breeders in TAS/WA/NT, which have no official state-
  // level Breeder ID system, plus breeders who simply haven't filled it
  // in yet — both are valid "nothing to show" states, not errors.
  breederIdType?: 'BIN_NSW' | 'BIN_ACT' | 'SOURCE_NUMBER_VIC' | 'SUPPLY_NUMBER_QLD' | 'DACO_SA' | 'ASSOC_MEMBER_TAS' | 'ASSOC_MEMBER_WA' | 'ASSOC_MEMBER_NT' | 'NONE'
  breederIdValue?: string
  // Legacy: old microchip cert scans stored a permanent public Storage
  // URL here directly (microchipCertUrl). New scans instead store
  // microchipCertPath (a private Storage path) and a short-lived signed
  // URL is fetched on demand — see viewDocument() in DogDetailPage.tsx.
  microchipCertUrl?: string
  microchipCertPath?: string
  createdAt: string
  updatedAt: string

  // Back-reference to the litters/{id} doc this puppy was born into —
  // set once at creation via LittersPage's handleAddPuppy, never
  // reassigned. Litters only carry the forward reference (puppyIds), so
  // this is what lets litter deletion verify EXACT membership (both
  // directions must agree) instead of trusting puppyIds alone. Absent
  // on any dog created before this field existed, and on dogs never
  // added via the litter flow (e.g. DogNewPage) — legacy litters fall
  // back to the forward-reference-only check.
  litterId?: string
  // ── Ownership (already written by transferDogOwnership) ──
  status?: 'active' | 'transferred'
  buyerName?: string
  buyerEmail?: string
  buyerPhone?: string
  transferredAt?: string
  // Set by transferDogOwnership() alongside the fields above — the uid
  // of whoever held the dog immediately before this transfer. Existed in
  // real Firestore documents before it was ever declared here (a type-
  // completeness gap, not a functional one). transferStatus is set by
  // the SAME call ('pendingClaim') and cleared by the claim route.
  previousOwnerId?: string
  transferStatus?: 'pendingClaim'
  // Written only by api/claim-transferred-dogs.js (Admin SDK, bypasses
  // rules) once a buyer actually claims a transferred dog — permanent
  // record that a claim happened, independent of buyerEmail/
  // transferredAt (which describe the BREEDER's side of the transfer).
  claimedAt?: string
  claimedBy?: string

  // ── Commercial lifecycle (M7 #2 — puppy sale funnel) ──
  availabilityStatus?: 'available' | 'reserved' | 'kept' | 'sold'
  reservedForName?: string
  reservedForEmail?: string
  reservedForPhone?: string
  reservedAt?: string
  depositStatus?: 'none' | 'pending' | 'received'
  depositAmount?: number
  depositReceivedAt?: string

  // ── Breeding history (edited on compliance tab, stored on Dog) ──
  pedigreeRegister?: 'main' | 'limited' | 'no_pedigree' | 'mixed' | 'rescue'
  litterCount?: number
  last18mLitters?: number
  cSectionCount?: number
  lastLitterDate?: string
}

export interface VaccineRecord {
  id: string
  dogId: string
  name: string
  dateGiven: string
  nextDue?: string
  vetClinic?: string
  batchNumber?: string
  uncertain?: boolean
  documentUrl?: string | null
  documentPath?: string | null
  createdAt: string
}

export interface WormingRecord {
  id: string
  dogId: string
  product: string
  dateGiven: string
  nextDue?: string
  weightKg?: number
  createdAt: string
}

export interface HealthTest {
  id: string
  dogId: string
  testType: 'hip' | 'elbow' | 'eye' | 'dna' | 'cardiac' | 'other'
  result: string
  dateTested: string
  certNumber?: string
  lab?: string
  documentUrl?: string
  documentPath?: string
  createdAt: string
}

export interface Reminder {
  id: string
  dogId: string
  type: 'vaccination' | 'worming' | 'vet_appointment' | 'heat_cycle' | 'custom'
  title: string
  dueDate: string
  notifyDaysBefore: number
  status: 'pending' | 'overdue' | 'completed'
  completedAt?: string
  createdAt: string
}

export interface Document {
  id: string
  dogId: string
  category: 'pedigree' | 'vaccine_cert' | 'health_test' | 'contract' | 'photo' | 'other'
  name: string
  fileUrl?: string
  filePath?: string
  fileType: string
  fileSizeMb: number
  isPublic: boolean
  createdAt: string
}

export interface Litter {
  id: string
  tenantId: string
  name: string
  sireId?: string | null
  sireName?: string | null
  damId: string
  matingSuspectedDate?: string
  expectedDueDate?: string
  actualBirthDate?: string
  notes: string
  puppyIds: string[]
  createdAt: string
  // Set by api/delete-litter.js (Codex round 5, Blocker 2) instead of
  // hard-deleting the litter document, whenever a transferred/claimed/
  // history-bearing Dog is still linked to it — the document is kept
  // (never deleted) so that Dog's litterId back-reference always
  // resolves to something real, preserving lineage. Excluded from the
  // breeder's normal Litters list (see getLitters() in lib/db.ts).
  archived?: boolean
  archivedAt?: string
}

// ═════════════════════════════════════════════════════════════
// ⚠ IZIPAWS-TARGET SCHEMA — NOT USED BY iDogs V1 (satellite).
//
// These four types are legacy from the original IZIPAWS-first plan.
// iDogs is now a lightweight satellite: it stores CURRENT commercial
// state as optional fields on `Dog` (availabilityStatus / reservedFor*
// / deposit* / buyer*) and derives Buyers as a view — NO Buyers or
// Sales collection. See M7_DATA_MODEL.md §1 & §7b.
//
// Kept (not deleted) as the migration TARGET for when iDogs data later
// graduates to the IZIPAWS identity layer (real Buyers, sales history,
// invite-based ownership transfer, QR passport permissions).
//
// DO NOT build iDogs V1 features, collections, APIs or CRUD on these.
// They have zero runtime usage by design.
// ═════════════════════════════════════════════════════════════
export interface BuyerRecord {
  id: string
  tenantId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  state: string
  postcode: string
  notes: string
  createdAt: string
}

export interface Sale {
  id: string
  dogId: string
  buyerId: string
  salePrice: number
  depositPaid: number
  saleDate: string
  status: 'reserved' | 'deposit_paid' | 'sold' | 'cancelled'
  transferInitiated: boolean
  createdAt: string
}

export interface OwnershipTransfer {
  id: string
  dogId: string
  fromOwnerId: string
  toOwnerEmail: string
  toOwnerId?: string
  documentIds: string[]
  inviteToken: string
  inviteStatus: 'pending' | 'accepted' | 'expired'
  transferredAt?: string
  createdAt: string
}

export interface PassportVisibility {
  dogId: string
  name: boolean
  breed: boolean
  age: boolean
  vaccineStatus: boolean
  allergyAlerts: boolean
  microchip: boolean
  emergencyContact: boolean
  vaccineHistory: boolean
  healthTests: boolean
  pedigree: boolean
  ownerName: boolean
  ownerPhone: boolean
}

// ── end IZIPAWS-target block ── (types below are ACTIVE in iDogs V1)
export interface ScanLog {
  id: string
  dogId: string
  passportId: string
  scannedAt: string
  country?: string
  grantId?: string
  result: 'public_view' | 'access_granted' | 'access_denied'
}

export interface ActivityNote {
  id: string
  dogId: string
  note: string
  photoUrl?: string
  createdBy: string
  createdAt: string
  noteDate?: string
}

export interface UserProfile {
  uid: string
  email: string
  firstName: string
  lastName: string
  kennelName: string
  ankc: string
  phone: string
  address: string
  state: 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'
  postcode: string
  role: 'breeder' | 'owner' | 'admin'
  plan: 'trial' | 'starter' | 'professional' | 'kennel'
  trialEndsAt: string
  // Account-level Breeder ID (e.g. DACO number for SA breeders). Mandatory
  // for active breeders in most states, but some breeders genuinely don't
  // have one yet (e.g. dogs too young to be bred from yet) — so this is
  // optional, not required at signup. Per-dog breederIdType/breederIdValue
  // on Dog still exists separately for cases where a dog's own record
  // needs to show a different/overriding value.
  breederIdType?: Dog['breederIdType']
  breederIdValue?: string
  createdAt: string
}

// ── UI TYPES ──────────────────────────────────────────────────

export interface ToastMessage {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

export interface NavItem {
  label: string
  path: string
  icon: string
}

// ── FORM TYPES ─────────────────────────────────────────────────

export interface DogFormData {
  name: string
  breed: string
  sex: Sex
  dateOfBirth: string
  colour: string
  microchip: string
  ankc: string
  notes: string
  pedigreeRegister?: string
  breederIdType?: Dog['breederIdType']
  breederIdValue?: string
  litterId?: string
}

export interface AuthFormData {
  email: string
  password: string
}

export interface SignupFormData extends AuthFormData {
  firstName: string
  lastName: string
  kennelName: string
  role?: 'breeder' | 'owner'
  state?: string
  breederNumber?: string
}
