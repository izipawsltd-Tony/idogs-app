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
  const platform = nativePlatform?.trim().toLowerCase()
  return platform === 'android' || platform === 'ios'
}

export function androidAuthPersistencePreference<T>(browserLocal: T, indexedDb: T): [T, T] {
  return [browserLocal, indexedDb]
}
