// Google Play does not allow purchase/subscription UI for digital services
// inside the Android app shell (server-side calls are already blocked by
// nativeApiRouting.ts). This reads the same data-idogsNativePlatform marker
// main.tsx sets at boot so billing UI can also hide the purchase controls
// themselves, not just fail the request behind them.
export function isAndroidNativeApp(doc: Pick<Document, 'documentElement'> = document): boolean {
  return doc.documentElement.dataset.idogsNativePlatform === 'android'
}

export function isNativeApp(doc: Pick<Document, 'documentElement'> = document): boolean {
  return ['android', 'ios'].includes(doc.documentElement.dataset.idogsNativePlatform || '')
}
