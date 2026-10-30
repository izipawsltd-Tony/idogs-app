export function australianSmsEnabled(settings) {
  if (settings.signIn?.phoneNumber?.enabled !== true) return false
  const regions = settings.smsRegionConfig
  if (regions?.allowlistOnly) return regions.allowlistOnly.allowedRegions?.includes('AU') === true
  if (regions?.allowByDefault) return !regions.allowByDefault.disallowedRegions?.includes('AU')
  return false
}
