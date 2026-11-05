export const PLUS_PROMOTION_ID = 'plus-free-through-jan-2027'
export const PLUS_PROMOTION_START = Date.parse('2026-10-20T13:30:00Z')
export const PLUS_PROMOTION_END = Date.parse('2027-01-31T13:30:00Z')
export const PLUS_PROMOTION_TERMS = 'A$0/month through 31 January 2027 (Adelaide time), then A$7/month from 1 February 2027, including GST. Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.'
export function isPlusPromotionActive(now = Date.now()) {
  return Number.isFinite(now) && now >= PLUS_PROMOTION_START && now < PLUS_PROMOTION_END
}
