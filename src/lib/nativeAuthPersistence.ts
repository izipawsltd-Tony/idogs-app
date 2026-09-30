export type CapacitorRuntimeLike = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

export function resolveNativePlatform(
  buildPlatform: string | undefined,
  capacitor?: CapacitorRuntimeLike,
): string {
  const embedded = buildPlatform?.trim().toLowerCase()
  if (embedded) return embedded
  if (!capacitor?.isNativePlatform?.()) return ''
  return capacitor.getPlatform?.()?.trim().toLowerCase() || 'native'
}

export function shouldUseBrowserLocalAuthPersistence(nativePlatform?: string): boolean {
  return nativePlatform?.trim().toLowerCase() === 'android'
}
