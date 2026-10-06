// Native origins (https://localhost) cannot be shared outside the app.
// Keep web Preview links and dedicated native QA on their own environments.
export function publicAppOrigin(
  origin: string = window.location.origin,
  dataset: DOMStringMap = document.documentElement.dataset,
): string {
  if (dataset.idogsNativePlatform && dataset.idogsNativeApi === 'production') return 'https://idogs.com.au'
  if (dataset.idogsNativePlatform && dataset.idogsNativeApi === 'dedicated-staging-qa') return 'https://idogs-native-api-qa-izipaws.vercel.app'
  return origin
}
