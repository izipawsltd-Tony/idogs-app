import type { WormingRecord } from '../types'

export interface WormingEdit { product: string; dateGiven: string; nextDue: string; weightKg: string }

// Validated field changes for a worming edit. A cleared optional field is
// removed from the record (never stored as an empty string or 0).
export function wormingEditChanges(form: WormingEdit): { set: Partial<WormingRecord>; clear: Array<'nextDue' | 'weightKg'> } {
  const product = form.product.trim()
  if (!product) throw new Error('Product is required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateGiven)) throw new Error('Date given is required')
  if (form.nextDue && !/^\d{4}-\d{2}-\d{2}$/.test(form.nextDue)) throw new Error('Choose a valid next due date')
  const weight = form.weightKg.trim() === '' ? null : Number(form.weightKg)
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 200)) throw new Error('Weight must be between 0 and 200 kg')
  const set: Partial<WormingRecord> = { product, dateGiven: form.dateGiven }
  const clear: Array<'nextDue' | 'weightKg'> = []
  if (form.nextDue) set.nextDue = form.nextDue; else clear.push('nextDue')
  if (weight !== null) set.weightKg = weight; else clear.push('weightKg')
  return { set, clear }
}
