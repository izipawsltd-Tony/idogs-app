import { describe, expect, it } from 'vitest'
import {
  aiScanQuotaExhaustedMessage,
  dogLimitReachedBody,
  exportPlanGateMessage,
  litterShowcasePlanGateMessage,
  puppyAddedRestrictedMessage,
  restrictedBreederIdMessage,
  restrictedPuppyAssignBuyerMessage,
  restrictedPuppyEditMessage,
  restrictedPuppyMediaMessage,
  restrictedSaleAvailabilityMessage,
  sidebarPurchasesUnavailableNotice,
} from './nativeUpgradeCopy'

// Google Play rejects apps that steer Android users toward purchases made
// outside Google Play Billing. Every message below is shown outside
// BillingPage, so the Android branch must never invite the user to
// "upgrade" or quote a price — it must only describe the free workaround
// (activate/free up a slot) or state the feature plainly isn't available.
// (Neutral phrasing like "purchases are unavailable" is fine — it states
// unavailability rather than steering toward a purchase.)
const FORBIDDEN_ON_ANDROID = /\bupgrad\w*\b|\$\d/i

describe('native upgrade copy — Android Play policy gate', () => {
  it('never mentions upgrading/purchasing on Android, but does on web', () => {
    const pairs: Array<[string, string]> = [
      [aiScanQuotaExhaustedMessage(true, false), aiScanQuotaExhaustedMessage(false, false)],
      [restrictedBreederIdMessage(true), restrictedBreederIdMessage(false)],
      [restrictedSaleAvailabilityMessage(true), restrictedSaleAvailabilityMessage(false)],
      [dogLimitReachedBody(true), dogLimitReachedBody(false)],
      [exportPlanGateMessage(true), exportPlanGateMessage(false)],
      [restrictedPuppyAssignBuyerMessage(true), restrictedPuppyAssignBuyerMessage(false)],
      [puppyAddedRestrictedMessage(true, 'Sigma'), puppyAddedRestrictedMessage(false, 'Sigma')],
      [restrictedPuppyEditMessage(true), restrictedPuppyEditMessage(false)],
      [litterShowcasePlanGateMessage(true), litterShowcasePlanGateMessage(false)],
      [restrictedPuppyMediaMessage(true, 'Lulu'), restrictedPuppyMediaMessage(false, 'Lulu')],
    ]

    for (const [androidMessage, webMessage] of pairs) {
      expect(androidMessage).not.toMatch(FORBIDDEN_ON_ANDROID)
      expect(webMessage).toMatch(FORBIDDEN_ON_ANDROID)
      // Android copy must still be distinct, non-empty guidance — not a
      // blank string that silently drops the explanation.
      expect(androidMessage.trim().length).toBeGreaterThan(0)
      expect(androidMessage).not.toBe(webMessage)
    }
  })

  it('AI scan quota message ignores the Android flag once the user is on Plus', () => {
    const plusMessage = "You've used all 10 AI scans for this billing period — resets next period."
    expect(aiScanQuotaExhaustedMessage(true, true)).toBe(plusMessage)
    expect(aiScanQuotaExhaustedMessage(false, true)).toBe(plusMessage)
  })

  it('interpolates the dog/puppy name into templated messages', () => {
    expect(puppyAddedRestrictedMessage(true, 'Rex')).toContain('Rex')
    expect(puppyAddedRestrictedMessage(false, 'Rex')).toContain('Rex')
    expect(restrictedPuppyMediaMessage(true, 'Bella')).toContain('Bella')
    expect(restrictedPuppyMediaMessage(false, 'Bella')).toContain('Bella')
  })

  it('sidebar Android notice is neutral and non-empty', () => {
    const notice = sidebarPurchasesUnavailableNotice()
    expect(notice).not.toMatch(FORBIDDEN_ON_ANDROID)
    expect(notice.trim().length).toBeGreaterThan(0)
  })
})
