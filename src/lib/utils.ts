import { format, formatDistance, isAfter, isBefore, addDays, differenceInYears, differenceInMonths } from 'date-fns'
import type { Dog, LifeStage } from '../types'

// ── ID GENERATION ─────────────────────────────────────────────

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function nanoid(len = 4): string {
  let result = ''
  for (let i = 0; i < len; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return result
}

// ── DATE HELPERS ──────────────────────────────────────────────

export function formatDate(date: string | Date | undefined): string {
  if (!date) return '—'
  try {
    return format(new Date(date), 'dd MMM yyyy')
  } catch {
    return '—'
  }
}

export function formatDateShort(date: string | undefined): string {
  if (!date) return '—'
  try {
    return format(new Date(date), 'dd/MM/yy')
  } catch {
    return '—'
  }
}

export function timeAgo(date: string | undefined): string {
  if (!date) return ''
  try {
    return formatDistance(new Date(date), new Date(), { addSuffix: true })
  } catch {
    return ''
  }
}

export function getDogAge(dob: string): string {
  if (!dob) return ''
  const birth = new Date(dob)
  const now = new Date()
  const years = differenceInYears(now, birth)
  const months = differenceInMonths(now, birth) % 12
  if (years === 0) return `${months} month${months !== 1 ? 's' : ''}`
  if (months === 0) return `${years} yr`
  return `${years} yr ${months} mo`
}

export function isOverdue(dueDate: string): boolean {
  return isBefore(new Date(dueDate), new Date())
}

export function isDueSoon(dueDate: string, daysBefore = 7): boolean {
  const due = new Date(dueDate)
  const now = new Date()
  const soon = addDays(now, daysBefore)
  return isAfter(due, now) && isBefore(due, soon)
}

export function getVaccineStatus(nextDue: string | undefined): 'current' | 'due_soon' | 'overdue' | 'unknown' {
  if (!nextDue) return 'unknown'
  if (isOverdue(nextDue)) return 'overdue'
  if (isDueSoon(nextDue)) return 'due_soon'
  return 'current'
}

// ── MILESTONES (birthdays & anniversaries) ──────────────────────

export type Milestone = {
  kind: 'birthday' | 'anniversary'
  years: number
  label: string
}

/**
 * Checks whether today is the dog's birthday or the anniversary of
 * joining the family (based on createdAt, i.e. when the profile was
 * first added to iDogs). Returns null if today isn't either of those.
 * Matches month+day only, ignoring year, ignoring time-of-day.
 */
// FIX (bug found via staging screenshot: Timeline showing "2th birthday",
// "3th birthday", "4th birthday" instead of "2nd", "3rd", "4th"): the
// previous logic only special-cased 1 ("1st") and hardcoded "th" for
// every other number, which is wrong English grammar for 2, 3, 4, 21,
// 22, 23, etc. This correctly handles the standard 1st/2nd/3rd/4th...
// pattern, including the 11/12/13 exception (these always use "th" even
// though they end in 1, 2, 3 — "11th" not "11st").
export function ordinal(n: number): string {
  const lastTwoDigits = n % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

export function getTodaysMilestone(dateOfBirth: string, createdAt: string): Milestone | null {
  const today = new Date()

  if (dateOfBirth) {
    const birth = new Date(dateOfBirth)
    if (birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate()) {
      const years = today.getFullYear() - birth.getFullYear()
      // Only celebrate from year 1 onwards — a dog born today isn't
      // having its "0th birthday", that's just being born.
      if (years > 0) {
        return { kind: 'birthday', years, label: `🎂 ${ordinal(years)} birthday today!` }
      }
    }
  }

  if (createdAt) {
    const joined = new Date(createdAt)
    if (joined.getMonth() === today.getMonth() && joined.getDate() === today.getDate()) {
      const years = today.getFullYear() - joined.getFullYear()
      if (years > 0) {
        return { kind: 'anniversary', years, label: `🏠 ${years} year${years > 1 ? 's' : ''} on iDogs today!` }
      }
    }
  }

  return null
}

// ── LIFE STAGE ────────────────────────────────────────────────

export type DogSize = 'small' | 'medium' | 'large' | 'giant'

// Size classification based on adult weight, adjusted from pure breed
// standard figures to match how the Australian pet industry (boarding,
// insurance, breed clubs) commonly categorises borderline breeds —
// e.g. French Bulldog and Beagle are usually treated as Medium in
// practice despite sitting near the Small/Medium weight boundary, and
// Siberian Husky / Rottweiler are usually treated as Large.
export const BREED_SIZE: Record<string, DogSize> = {
  'Cavalier King Charles Spaniel': 'small',
  'Poodle (Miniature)': 'small',
  'Maltese': 'small',
  'Shih Tzu': 'small',
  'Border Terrier': 'small',
  'Jack Russell Terrier': 'small',
  'Dachshund': 'small',

  'French Bulldog': 'medium',
  'Beagle': 'medium',
  'Border Collie': 'medium',
  'Australian Shepherd': 'medium',
  'Staffordshire Bull Terrier': 'medium',
  'Cocker Spaniel': 'medium',
  'Bull Terrier': 'medium',
  'Whippet': 'medium',
  'English Springer Spaniel': 'medium',

  'Golden Retriever': 'large',
  'Labrador Retriever': 'large',
  'German Shepherd': 'large',
  'Poodle (Standard)': 'large',
  'Boxer': 'large',
  'Dobermann': 'large',
  'Irish Setter': 'large',
  'Pointer': 'large',
  'Dalmatian': 'large',
  'Weimaraner': 'large',
  'Siberian Husky': 'large',
  'Rottweiler': 'large',

  'Great Dane': 'giant',
  'Bernese Mountain Dog': 'giant',
}

export function getBreedSize(breed: string): DogSize {
  return BREED_SIZE[breed] || 'medium' // unknown/"Other" breeds default to medium
}

// Age bracket boundaries in months, by size. Senior has no upper bound.
// Sourced from multiple veterinary life-stage references and adjusted
// per industry feedback to smooth the adult→senior transition rather
// than having it jump sharply between size classes.
const LIFE_STAGE_MONTHS: Record<DogSize, { puppyEnd: number; youngAdultEnd: number; seniorStart: number }> = {
  small:  { puppyEnd: 12, youngAdultEnd: 24, seniorStart: 120 }, // senior ~10y
  medium: { puppyEnd: 12, youngAdultEnd: 24, seniorStart: 108 }, // senior ~9y
  large:  { puppyEnd: 14, youngAdultEnd: 24, seniorStart: 96 },  // senior ~8y
  giant:  { puppyEnd: 18, youngAdultEnd: 24, seniorStart: 84 },  // senior ~7y
}

/**
 * Calculates life stage using breed-aware age brackets. Falls back to
 * the medium-size brackets if no breed is provided or the breed isn't
 * recognised — this keeps existing callers (that only pass dob) working
 * without changes, while new callers can pass breed for more accurate
 * staging of large/giant breeds (who mature slower as puppies but reach
 * "senior" earlier than small breeds).
 */
export function calculateLifeStage(dob: string, breed?: string): LifeStage {
  if (!dob) return 'puppy'
  const birth = new Date(dob)
  const months = differenceInMonths(new Date(), birth)
  const size = breed ? getBreedSize(breed) : 'medium'
  const { puppyEnd, youngAdultEnd, seniorStart } = LIFE_STAGE_MONTHS[size]

  if (months < 2) return 'whelp'
  if (months < puppyEnd) return 'puppy'
  if (months < youngAdultEnd) return 'young_adult'
  if (months < seniorStart) return 'adult'
  return 'senior'
}

// The sex-agnostic half of Sire/Dam eligibility — a dog only makes sense
// as a *current breeder-controlled* breeding pick (regardless of which
// sex-specific role it's being considered for) if it's living, still
// under this account's active control (not transferred away), and
// sexually mature. A dog with no dateOfBirth (some legacy records) can't
// be proven mature, so calculateLifeStage's 'puppy' fallback for a
// missing dob correctly excludes it here too — "can't prove eligible"
// fails safe to "not eligible", never the other way round.
//
// Relies on `dog.status`/`transferStatus` already being correctly
// computed for the CURRENT user's viewpoint (i.e. the dog came from
// getDogs(), which re-derives 'transferred' from currentOwnerId — a raw
// tenantId-only Firestore query sees a transferred dog's stale
// post-claim status and must never feed this predicate).
// Whether a dog has left the breeder's active control — transferred to a
// buyer, or claimed-pending. Relies on `dog.status`/`transferStatus`
// already being correctly computed for the CURRENT user's viewpoint (see
// isCurrentBreederDog's note below on why that must come from getDogs()).
// Used on its own (not via isCurrentBreederDog) anywhere life-stage/
// deceased shouldn't factor in — e.g. deciding which of a litter's
// puppies are still safe to delete alongside the litter: a puppy is by
// definition puppy-stage, and a deceased-but-untransferred puppy is
// still fully the breeder's to delete.
export function isDogTransferred(dog: Pick<Dog, 'status'> & { transferStatus?: string }): boolean {
  return dog.status === 'transferred' || dog.transferStatus === 'pendingClaim'
}

// The sex-agnostic half of Sire/Dam eligibility — a dog only makes sense
// as a *current breeder-controlled* breeding pick (regardless of which
// sex-specific role it's being considered for) if it's living, still
// under this account's active control (not transferred away), and
// sexually mature. A dog with no dateOfBirth (some legacy records) can't
// be proven mature, so calculateLifeStage's 'puppy' fallback for a
// missing dob correctly excludes it here too — "can't prove eligible"
// fails safe to "not eligible", never the other way round.
//
// Relies on `dog.status`/`transferStatus` already being correctly
// computed for the CURRENT user's viewpoint (i.e. the dog came from
// getDogs(), which re-derives 'transferred' from currentOwnerId — a raw
// tenantId-only Firestore query sees a transferred dog's stale
// post-claim status and must never feed this predicate).
function isCurrentBreederDog(dog: Dog): boolean {
  if (dog.isDeceased) return false
  if (isDogTransferred(dog)) return false
  const stage = calculateLifeStage(dog.dateOfBirth, dog.breed)
  return stage !== 'whelp' && stage !== 'puppy'
}

// Shared by the Sire selectors in LittersPage (create litter) and
// DogDetailPage's HeatCycleModal (record a mating).
export function isEligibleSireDog(dog: Dog): boolean {
  return dog.sex === 'male' && isCurrentBreederDog(dog)
}

// Shared by the Dam selector in LittersPage (create litter) — same
// current-breeder-dog eligibility as isEligibleSireDog, plus female.
export function isEligibleDamDog(dog: Dog): boolean {
  return dog.sex === 'female' && isCurrentBreederDog(dog)
}

export const LIFE_STAGE_LABELS: Record<LifeStage, string> = {
  whelp: 'Born',
  puppy: 'Puppy',
  young_adult: 'Passport',
  adult: 'Adult',
  senior: 'Senior',
  remembered: 'Forever',
}

export const LIFE_STAGE_EMOJI: Record<LifeStage, string> = {
  whelp: '🐣',
  puppy: '🐶',
  young_adult: '📘',
  adult: '🐕',
  senior: '🌅',
  remembered: '♥️',
}

// ── BREED LIST ─────────────────────────────────────────────────

export const AU_TOP_BREEDS = [
  'Golden Retriever', 'Labrador Retriever', 'Border Collie', 'German Shepherd',
  'French Bulldog', 'Cavalier King Charles Spaniel', 'Poodle (Standard)',
  'Poodle (Miniature)', 'Australian Shepherd', 'Staffordshire Bull Terrier',
  'Rottweiler', 'Beagle', 'Cocker Spaniel', 'Maltese', 'Shih Tzu',
  'Boxer', 'Dobermann', 'Bull Terrier', 'Whippet', 'Border Terrier',
  'Jack Russell Terrier', 'Dachshund', 'Great Dane', 'Siberian Husky',
  'Bernese Mountain Dog', 'Irish Setter', 'Pointer', 'Dalmatian',
  'English Springer Spaniel', 'Weimaraner', 'Other',
]

// ── AU STATES ─────────────────────────────────────────────────

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']

// ── BREEDER ID (state-issued breeder identification numbers) ──────
//
// Per the NSW Puppy Farming Act 2024 and equivalent VIC/QLD/SA/ACT laws,
// buyers are increasingly expected to verify a breeder's official ID
// before purchasing. verifyUrl is null where the public lookup URL
// hasn't been independently confirmed (SA, ACT) or where no official
// state-level system exists at all (TAS/WA/NT only have optional breed
// association membership numbers, not government-issued IDs) — these
// should not be guessed, since sending a buyer to a wrong/made-up URL is
// worse than no link at all.
export type BreederIdType = 'BIN_NSW' | 'BIN_ACT' | 'SOURCE_NUMBER_VIC' | 'SUPPLY_NUMBER_QLD' | 'DACO_SA' | 'ASSOC_MEMBER_TAS' | 'ASSOC_MEMBER_WA' | 'ASSOC_MEMBER_NT' | 'NONE'

export const BREEDER_ID_CONFIG: Record<BreederIdType, { label: string; verifyUrl: string | null }> = {
  BIN_NSW: { label: 'Breeder Identification Number (NSW)', verifyUrl: 'https://www.petregistry.nsw.gov.au' },
  BIN_ACT: { label: 'Breeder Identification Number (ACT)', verifyUrl: null },
  SOURCE_NUMBER_VIC: { label: 'Pet Exchange Register Source Number (VIC)', verifyUrl: 'https://per.animalwelfare.vic.gov.au/search' },
  SUPPLY_NUMBER_QLD: { label: 'Supply Number (QLD)', verifyUrl: 'https://qdbr.daf.qld.gov.au/supply-number-search' },
  DACO_SA: { label: 'DACO Breeder Number (SA)', verifyUrl: null },
  ASSOC_MEMBER_TAS: { label: 'Dogs Tasmania / MDBA member number', verifyUrl: null },
  ASSOC_MEMBER_WA: { label: 'Dogs West member number', verifyUrl: null },
  ASSOC_MEMBER_NT: { label: 'Dogs NT member number', verifyUrl: null },
  NONE: { label: 'No official ID yet', verifyUrl: null },
}

// Per spec Section 1.3: suggests a sensible default breederIdType based
// on the breeder's registered state, since UserProfile.state already
// exists. This is a convenience default only — the breeder can always
// pick a different type (e.g. an interstate Dogs Australia breeder using a
// different state's ID).
export function suggestBreederIdType(breederState?: string): BreederIdType {
  switch (breederState) {
    case 'NSW': return 'BIN_NSW'
    case 'ACT': return 'BIN_ACT'
    case 'VIC': return 'SOURCE_NUMBER_VIC'
    case 'QLD': return 'SUPPLY_NUMBER_QLD'
    case 'SA': return 'DACO_SA'
    case 'TAS': return 'ASSOC_MEMBER_TAS'
    case 'WA': return 'ASSOC_MEMBER_WA'
    case 'NT': return 'ASSOC_MEMBER_NT'
    default: return 'NONE'
  }
}

// ── MISC ──────────────────────────────────────────────────────

export function classNames(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function truncate(str: string, maxLen = 30): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}

export function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
