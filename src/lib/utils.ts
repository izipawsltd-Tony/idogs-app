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

// ── LIFE STAGE ────────────────────────────────────────────────

export function calculateLifeStage(dob: string): LifeStage {
  if (!dob) return 'puppy'
  const birth = new Date(dob)
  const months = differenceInMonths(new Date(), birth)
  if (months < 3) return 'whelp'
  if (months < 12) return 'puppy'
  if (months < 24) return 'young_adult'
  if (months < 84) return 'adult'
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
