import { format, formatDistance, isAfter, isBefore, addDays, differenceInYears, differenceInMonths } from 'date-fns'
import type { LifeStage } from '../types'

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
export function getTodaysMilestone(dateOfBirth: string, createdAt: string): Milestone | null {
  const today = new Date()

  if (dateOfBirth) {
    const birth = new Date(dateOfBirth)
    if (birth.getMonth() === today.getMonth() && birth.getDate() === today.getDate()) {
      const years = today.getFullYear() - birth.getFullYear()
      // Only celebrate from year 1 onwards — a dog born today isn't
      // having its "0th birthday", that's just being born.
      if (years > 0) {
        return { kind: 'birthday', years, label: `🎂 ${years === 1 ? '1st' : `${years}th`} birthday today!` }
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
