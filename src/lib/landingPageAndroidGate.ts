// Signed-out Android builds must not steer users toward purchasing digital
// services outside Google Play. Web keeps the normal paid-plan promotion.
export function showLandingPaidPromotion(isAndroid: boolean): boolean {
  return !isAndroid
}
