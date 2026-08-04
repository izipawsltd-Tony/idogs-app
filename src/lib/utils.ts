import { format, formatDistance, isAfter, isBefore, addDays, differenceInYears, differenceInMonths } from 'date-fns'
import type { Dog, LifeStage, UserProfile } from '../types'

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

// The single canonical DOB parser/validator — anywhere a dateOfBirth is
// accepted as new data or relied on to prove breeding maturity must go
// through this, never a bare `new Date(dob)`. Rejects (returns null
// for) anything that can't be trusted:
//   - missing / not a string (defensive — Firestore is schemaless at
//     runtime, so a document can carry any type regardless of what the
//     TS type says)
//   - not exactly YYYY-MM-DD (catches unparsable strings and malformed
//     legacy values)
//   - an impossible calendar date — JS Date silently ROLLS OVER
//     "2020-02-30" into March 1st instead of rejecting it; this is
//     caught by round-tripping the parsed components back against the
//     input and requiring an exact match
//   - a date in the future
// A null result must always be treated as "cannot prove maturity",
// never as a free pass — see calculateLifeStage below, which used to
// silently fall through to 'senior' (i.e. treated as breeding-eligible)
// for exactly this class of malformed input, because every numeric
// comparison against NaN evaluates to false.
export function parseDobStrict(dob: unknown): Date | null {
  if (typeof dob !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null
  // Future-date check compares calendar-date components (Y, M, D)
  // directly, never an absolute instant (parsed.getTime() vs
  // Date.now()). A DOB dated "today" must never be rejectable — but
  // comparing instants makes that depend on what time of day the check
  // happens to run, and mixing UTC-based helpers (toISOString()) with
  // local-based ones (setDate()) anywhere nearby silently shifts which
  // calendar date "today" even means. Component comparison sidesteps
  // both: the same date string always evaluates the same way relative
  // to whatever this machine's own Date() calls "today", with no
  // instant/epoch or UTC/local mixing involved anywhere.
  const today = new Date()
  const isFuture = year > today.getFullYear() ||
    (year === today.getFullYear() && month - 1 > today.getMonth()) ||
    (year === today.getFullYear() && month - 1 === today.getMonth() && day > today.getDate())
  if (isFuture) return null
  return parsed
}

/**
 * Calculates life stage using breed-aware age brackets. Falls back to
 * the medium-size brackets if no breed is provided or the breed isn't
 * recognised — this keeps existing callers (that only pass dob) working
 * without changes, while new callers can pass breed for more accurate
 * staging of large/giant breeds (who mature slower as puppies but reach
 * "senior" earlier than small breeds). A missing OR malformed dob
 * (unparsable, impossible calendar date, future date) both fail safe to
 * 'puppy' — "can't prove otherwise" must never resolve to a mature stage.
 */
export function calculateLifeStage(dob: string, breed?: string): LifeStage {
  const birth = parseDobStrict(dob)
  if (!birth) return 'puppy'
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

// Pricing v1.2 — hand-synced, field-for-field mirror of
// api/_lib/dog-cap.js's isEligibleForCap() (the SERVER-authoritative
// predicate; this repo's established pattern for keeping a Rules/backend-
// authoritative check and its client-side display twin in sync, same as
// isDogHistoryBearing below). NEVER authoritative for enforcement — only
// used so the UI's own dog-usage count (AppLayout.tsx's "X / 5 dogs" bar)
// agrees with what the backend actually enforces, instead of the
// pre-v1.2 UI count (every non-transferred dog, including archived and
// restricted ones) which could show a materially different number than
// the account's TRUE active-eligible count.
export function isDogEligibleForCap(dog: Pick<Dog, 'status' | 'isDeceased' | 'litterId' | 'retainedByBreeder' | 'currentOwnerId' | 'tenantId'>): boolean {
  if ((dog.status || 'active') !== 'active') return false
  if (dog.isDeceased === true) return false
  const isUnpromotedLitterPuppy = !!dog.litterId &&
    dog.retainedByBreeder !== true &&
    dog.currentOwnerId === dog.tenantId
  return !isUnpromotedLitterPuppy
}

// Mirrors firestore.rules' dogs/{dogId} `allow delete` rule and
// api/_lib/litter-eligibility.js's isDogHistoryBearing field-for-field —
// this repo's established pattern for a Rules-authoritative check that
// also needs a client-side UI preview (see litter-eligibility.js's own
// header comment on why these stay hand-synced duplicates rather than a
// shared cross-runtime import: LittersPage.tsx already keeps its own
// local copy for exactly this reason). NEVER authoritative — deletion is
// still enforced by Firestore Rules, unchanged; this only decides
// whether the UI offers the Delete action and what it tells the user, so
// a stale client read here is harmless (the server always re-decides
// fresh). Presence, not truthiness — even an explicit null counts as
// history, matching the Rule's `'field' in resource.data` semantics; a
// field simply never having been written is the only "clean" case.
const DOG_HISTORY_FIELD_NAMES = ['buyerEmail', 'previousOwnerId', 'transferredAt', 'claimedAt', 'claimedBy'] as const

export function isDogHistoryBearing(dog: Record<string, unknown>): boolean {
  return DOG_HISTORY_FIELD_NAMES.some(field => Object.prototype.hasOwnProperty.call(dog, field))
}

// Whether the current user could actually delete this dog right now, per
// the exact same three gates as firestore.rules' dogs delete rule:
// effective current owner, no transfer in flight, and no ownership-
// history field present at all. The history check alone is what also
// catches a CLAIMED dog whose status has already reverted to 'active' —
// claiming (api/claim-transferred-dogs.js) resets status and clears
// transferStatus, but buyerEmail/previousOwnerId/transferredAt/
// claimedAt/claimedBy are permanent provenance and never cleared, so
// isDogTransferred() alone would wrongly call such a dog deletable.
// Deliberately a pure function of (dog, userId) only — never touches
// profile/role state — so its answer can't drift across a role switch or
// a stale client cache; only fresh dog data changes the outcome.
export function isDogDeletableByUser(dog: Dog, userId: string): boolean {
  if (!userId || dog.currentOwnerId !== userId) return false
  if (isDogTransferred(dog)) return false
  if (isDogHistoryBearing(dog as unknown as Record<string, unknown>)) return false
  return true
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

// ── BILLING / ENTITLEMENTS (client-side UI preview) ─────────────

// Mirrors api/_lib/entitlements.js's computeEffectivePlan() field-for-
// field, including the 7-day past_due grace window (iDogs Pricing v1.1,
// Pricing_Decision_Record_v1.1.md §4.2) — this repo's established
// pattern for a server-authoritative check that also needs a client-side
// UI preview (see isDogHistoryBearing above / litter-eligibility.js's
// own header comment on why these stay hand-synced duplicates rather
// than a shared cross-runtime import). NEVER authoritative on its own —
// every server endpoint that gates on plan (litters, Showcase, scans,
// exports) re-derives this fresh from a trusted users/{uid} read; this
// only decides what the UI shows (active controls vs. an
// upgrade/unavailable state) for an account whose grace period has
// already lapsed, so a stale/optimistic client profile read here is
// harmless — a request against a truly expired-grace account still gets
// a 403 from the server regardless of what this function said a moment
// earlier.
const PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000

// Mirrors computeEffectivePlan()'s internal-entitlement fallback (see that
// function's own comment in api/_lib/entitlements.js, including the
// fail-closed expiresAt handling — a malformed/non-string expiresAt must
// never be silently treated as "no expiry" the way a naive `new
// Date(garbage).getTime()` -> NaN check would) — display-only, same as
// the rest of this function; the server re-derives this fresh from a
// trusted users/{uid} read on every gated request regardless of what this
// says.
function hasValidInternalEntitlementClient(
  entitlement: UserProfile['internalEntitlement'],
  now: Date
): boolean {
  if (!entitlement || entitlement.granted !== true) return false
  const expiresAt = entitlement.expiresAt
  if (expiresAt === null || expiresAt === undefined) return true
  if (typeof expiresAt !== 'string') return false
  const expiresAtMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresAtMs)) return false
  return now.getTime() < expiresAtMs
}

export function getEffectivePlanClient(
  profile: Pick<UserProfile, 'plan' | 'subscriptionStatus' | 'pastDueSince' | 'internalEntitlement'> | null | undefined,
  now: Date = new Date()
): 'free' | 'plus' {
  const rawPlan = profile?.plan === 'plus' ? 'plus' : 'free'
  let paidPlanActive = rawPlan === 'plus'
  if (paidPlanActive && profile?.subscriptionStatus === 'past_due' && profile?.pastDueSince) {
    const since = new Date(profile.pastDueSince).getTime()
    if (!Number.isNaN(since) && now.getTime() - since > PLAN_GRACE_MS) paidPlanActive = false
  }
  if (paidPlanActive) return 'plus'
  if (hasValidInternalEntitlementClient(profile?.internalEntitlement, now)) return 'plus'
  return 'free'
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
