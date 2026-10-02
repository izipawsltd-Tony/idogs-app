const REQUIRED_CLIENT_FIELDS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

// Validate before any client config is exported or an Android bundle is built.
// Errors identify fields only; client values never need to appear in build logs.
export function assertNativeProductionEnvironment(values) {
  for (const field of REQUIRED_CLIENT_FIELDS) {
    const value = values[field]
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
      throw new Error(`FAIL CLOSED: ${field} missing or invalid`)
    }
  }
  if (values.VITE_FIREBASE_PROJECT_ID !== 'idogs-app') {
    throw new Error('FAIL CLOSED: production Android requires Firebase project idogs-app')
  }
  if (values.VITE_FIREBASE_AUTH_DOMAIN !== 'idogs-app.firebaseapp.com') {
    throw new Error('FAIL CLOSED: production Android Firebase Auth domain mismatch')
  }
}
