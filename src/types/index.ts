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
  damId: string
  matingSuspectedDate?: string
  expectedDueDate?: string
  actualBirthDate?: string
  notes: string
  puppyIds: string[]
  createdAt: string
}

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
  breederIdType?: Dog['breederIdType']
  breederIdValue?: string
}

export interface AuthFormData {
  email: string
  password: string
}

export interface SignupFormData extends AuthFormData {
  firstName: string
  lastName: string
  kennelName: string
}
