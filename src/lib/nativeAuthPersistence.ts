// Android's Capacitor WebView must keep Firebase Auth across process restarts.
// Keep this decision pure so web/iOS cannot accidentally inherit the native
// persistence override during a future auth refactor.
export function shouldUseBrowserLocalAuthPersistence(
  nativePlatform: string | undefined,
): boolean {
  return nativePlatform?.trim().toLowerCase() === 'android'
}
