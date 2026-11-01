export function australianSmsEnabled(settings) {
  if (settings.signIn?.phoneNumber?.enabled !== true) return false
  const regions = settings.smsRegionConfig
  if (regions?.allowlistOnly) return regions.allowlistOnly.allowedRegions?.includes('AU') === true
  if (regions?.allowByDefault) return !regions.allowByDefault.disallowedRegions?.includes('AU')
  return false
}

// Public, non-secret sign-in availability summary for funnel diagnostics
// (Owner P0 "zero new signups"). Booleans/enums only — no project IDs,
// keys, region lists or user data.
//   emailPassword — Email/Password provider enabled (email signup on /signup)
//   smsAustralia  — 'allowed' | 'blocked' | 'disabled' for +61 numbers
//                   (Firebase default with no SMS region policy = all allowed)
export function signupAvailability(settings) {
  const phoneOn = settings?.signIn?.phoneNumber?.enabled === true
  const regions = settings?.smsRegionConfig
  let smsAustralia = 'disabled'
  if (phoneOn) {
    if (regions?.allowlistOnly) smsAustralia = regions.allowlistOnly.allowedRegions?.includes('AU') ? 'allowed' : 'blocked'
    else if (regions?.allowByDefault) smsAustralia = regions.allowByDefault.disallowedRegions?.includes('AU') ? 'blocked' : 'allowed'
    else smsAustralia = 'allowed'
  }
  return { emailPassword: settings?.signIn?.email?.enabled === true, smsAustralia }
}
