import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'

// App + Auth only. Kept separate from ./firebase (Firestore + Storage) so the
// public landing/signup entry bundle does not have to download and parse the
// Firestore and Storage SDKs before first paint (mobile ad traffic).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// CI journey E2E only (e2e/journey): see ./firebase for the Firestore half.
export const useEmulators = import.meta.env.VITE_FIREBASE_EMULATOR === '1' && typeof location !== 'undefined' && ['127.0.0.1', 'localhost'].includes(location.hostname)
if (useEmulators) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
