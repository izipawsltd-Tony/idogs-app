export interface AccessGrantOfferBase { id: string; kind: 'founding' | 'gift'; months: number }
export const FOUNDING_OFFER: AccessGrantOfferBase & {
  kind: 'founding'; priceCents: number; currency: string; seats: number
  salesStart: number; salesEnd: number; productName: string; terms: string
}
export const GIFT_OFFER: AccessGrantOfferBase & { kind: 'gift'; maxRedemptions: number; redeemStart: number; redeemEnd: number }
export const ACCESS_GRANT_KINDS: readonly ['founding', 'gift']
export function addMonthsUTC(fromMs: number, months: number): number
export function accessGrantExpiryMs(grant: unknown): number | null
export function hasValidAccessGrant(profile: { accessGrant?: unknown } | null | undefined, now?: number | Date): boolean
export function extendedGrantExpiryMs(existingGrant: unknown, months: number, nowMs: number): number
