import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
// A three-part local-only guard: never redirect a normal QA/production build
// or project to emulators through a feature flag alone.
if (import.meta.env.DEV && import.meta.env.VITE_ACCOUNT_RECOVERY_QA === '1' && firebaseConfig.projectId === 'demo-idogs-account-mobile') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9299', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 9280)
}
if (import.meta.env.DEV && import.meta.env.VITE_ACCOUNT_ONBOARDING_QA === '1' && firebaseConfig.projectId === 'demo-idogs-account-onboarding') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9399', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 9380)
}
export default app
