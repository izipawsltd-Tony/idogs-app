// Google Play forbids purchase/subscription UI for digital goods inside the
// Android app shell (server-side purchase calls are already blocked in
// nativeApiRouting.ts). Read-only entitlement status, invoice history, and
// cancelling an existing add-on are all fine to keep — but BillingPage must
// never show Android users a price, a plan-picker interval, a "MOST
// POPULAR" promo ribbon, or copy that steers toward starting a new
// purchase. These pure helpers hold every Android/web copy and layout
// decision for that page so a future edit can't silently reintroduce
// pricing/upgrade UI on Android without breaking a test.

export function billingIntroCopy(isAndroid: boolean): string {
  return isAndroid
    ? 'Free forever for 1-2 dogs. Your current plan and what it includes are shown below.'
    : 'Simple pricing — free forever for 1-2 dogs, upgrade when you need more. Paid prices are in AUD and include GST.'
}

// Governs the interval toggle (Monthly/Annual), the "MOST POPULAR" ribbon,
// and the Plus price figures — all purchase-decision UI that must not
// render on Android, regardless of the viewer's current plan.
export function showPlanPricingUI(isAndroid: boolean): boolean {
  return !isAndroid
}

export function plusFeatureList(isAndroid: boolean): string[] {
  return [
    'Up to 5 dogs',
    'Everything in Free',
    '10 AI Document Scans / month',
    '2 litters per rolling 12 months',
    isAndroid ? 'Extra litters available beyond the included 2' : 'Extra litters A$39 each',
    'PDF & CSV report export',
  ]
}

export function androidPlanUnavailableNotice(): string {
  return 'Purchases are unavailable in this Android app.'
}

// Governs the SMS add-on's "$3 AUD / month" price line.
export function showSmsAddonPrice(isAndroid: boolean): boolean {
  return !isAndroid
}
