// Google Play forbids steering Android users toward purchases made outside
// Google Play Billing (server-side purchase calls are already blocked by
// nativeApiRouting.ts, and BillingPage itself already hides its own
// purchase controls on Android — see isAndroidNativeApp() there). These
// helpers centralize the neutral copy shown for every "Upgrade" prompt that
// lives OUTSIDE BillingPage, so a Play policy review has one small place to
// audit instead of scattered inline ternaries, and so a future edit can't
// silently reintroduce purchase-steering language on Android without a
// failing test.

export function aiScanQuotaExhaustedMessage(isAndroid: boolean, isPlus: boolean): string {
  if (isPlus) {
    return "You've used all 10 AI scans for this billing period — resets next period."
  }
  return isAndroid
    ? 'Free AI scans used up for this account.'
    : 'Free AI scans used up — upgrade to Plus for 10/month.'
}

export function restrictedBreederIdMessage(isAndroid: boolean): string {
  return isAndroid
    ? "This dog is over your plan's limit and is read-only — activate it in place of another dog to edit Breeder ID."
    : "This dog is over your plan's limit and is read-only — upgrade to Plus or activate it in place of another dog to edit Breeder ID."
}

export function restrictedSaleAvailabilityMessage(isAndroid: boolean): string {
  return isAndroid
    ? "This dog is over your plan's limit and is read-only — activate it in place of another dog to edit Sale & availability."
    : "This dog is over your plan's limit and is read-only — upgrade to Plus or activate it in place of another dog to edit Sale & availability."
}

export function dogLimitReachedBody(isAndroid: boolean): string {
  return isAndroid
    ? 'More dogs, iDogs Scan, documents, and ownership transfer are Plus-plan features not available on your current plan.'
    : 'Upgrade to add more dogs, unlock iDogs Scan, documents, and ownership transfer.'
}

export function exportPlanGateMessage(isAndroid: boolean): string {
  return isAndroid
    ? 'PDF/CSV export is an iDogs Plus feature and is not available on your current plan.'
    : 'PDF/CSV export is an iDogs Plus feature. Upgrade to Plus to export reports.'
}

export function restrictedPuppyAssignBuyerMessage(isAndroid: boolean): string {
  return isAndroid
    ? "This puppy is over your plan's dog limit and is read-only — free up a slot to assign a buyer."
    : "This puppy is over your plan's dog limit and is read-only — upgrade or free up a slot to assign a buyer."
}

export function puppyAddedRestrictedMessage(isAndroid: boolean, dogName: string): string {
  return isAndroid
    ? `${dogName} added, but is read-only — you're over your plan's dog limit. Free up a slot to edit it.`
    : `${dogName} added, but is read-only — you're over your plan's dog limit. Upgrade or free up a slot to edit it.`
}

export function restrictedPuppyEditMessage(isAndroid: boolean): string {
  return isAndroid
    ? "This puppy is over your plan's dog limit and is read-only — free up a slot to edit it."
    : "This puppy is over your plan's dog limit and is read-only — upgrade or free up a slot to edit it."
}

export function litterShowcasePlanGateMessage(isAndroid: boolean): string {
  return isAndroid
    ? 'Litter Showcase is a Plus-plan feature and is not available on your current plan.'
    : 'Litter Showcase is a Plus-plan feature — upgrade to curate which puppies from this litter can be showcased.'
}

export function restrictedPuppyMediaMessage(isAndroid: boolean, puppyName: string): string {
  return isAndroid
    ? `🔒 ${puppyName} is over your plan's dog limit and is read-only — media can't be added until it's activated.`
    : `🔒 ${puppyName} is over your plan's dog limit and is read-only — media can't be added until it's activated or you upgrade.`
}

export function sidebarPurchasesUnavailableNotice(): string {
  return 'Purchases are unavailable in this Android app.'
}
