import { describe, expect, it } from 'vitest'
import { showLandingPaidPromotion } from './landingPageAndroidGate'

describe('LandingPage Android paid-promotion gate', () => {
  it('hides paid promotion in native Android while preserving web', () => {
    expect(showLandingPaidPromotion(true)).toBe(false)
    expect(showLandingPaidPromotion(false)).toBe(true)
  })
})
