import { describe, expect, it } from 'vitest'
import {
  androidPlanUnavailableNotice,
  billingIntroCopy,
  plusFeatureList,
  showPlanPricingUI,
  showSmsAddonPrice,
  showExternalPaymentFaq,
} from './billingPageAndroidGate'

// Google Play rejects apps that show purchase/pricing UI for digital goods
// steering users toward buying outside Google Play Billing. BillingPage
// itself must render neutral, read-only entitlement info on Android — no
// prices, no plan-picker, no "upgrade" language.
const FORBIDDEN_ON_ANDROID = /\bupgrad\w*\b|\$\d/i

describe('BillingPage Android purchase-UI gate', () => {
  it('intro copy never mentions upgrading/pricing on Android, but does on web', () => {
    expect(billingIntroCopy(true)).not.toMatch(FORBIDDEN_ON_ANDROID)
    expect(billingIntroCopy(false)).toMatch(FORBIDDEN_ON_ANDROID)
    expect(billingIntroCopy(true).trim().length).toBeGreaterThan(0)
    expect(billingIntroCopy(true)).not.toBe(billingIntroCopy(false))
  })

  it('hides the plan-picker/ribbon/price UI on Android only', () => {
    expect(showPlanPricingUI(true)).toBe(false)
    expect(showPlanPricingUI(false)).toBe(true)
  })

  it('hides the SMS add-on price on Android only', () => {
    expect(showSmsAddonPrice(true)).toBe(false)
    expect(showSmsAddonPrice(false)).toBe(true)
  })

  it('Plus feature list drops the dollar figure on Android but keeps it on web', () => {
    const androidFeatures = plusFeatureList(true)
    const webFeatures = plusFeatureList(false)

    expect(androidFeatures).toHaveLength(webFeatures.length)
    for (const feature of androidFeatures) {
      expect(feature).not.toMatch(FORBIDDEN_ON_ANDROID)
    }
    expect(webFeatures.some(f => FORBIDDEN_ON_ANDROID.test(f))).toBe(true)
  })

  it('hides external-payment FAQ on Android only', () => {
    expect(showExternalPaymentFaq(true)).toBe(false)
    expect(showExternalPaymentFaq(false)).toBe(true)
  })

  it('Android plan-unavailable notice is neutral and non-empty', () => {
    const notice = androidPlanUnavailableNotice()
    expect(notice).not.toMatch(FORBIDDEN_ON_ANDROID)
    expect(notice.trim().length).toBeGreaterThan(0)
  })
})
