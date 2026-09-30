import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, initializeAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { shouldUseBrowserLocalAuthPersistence } from './nativeAuthPersistence'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const nativePlatform = import.meta.env.VITE_IDOGS_NATIVE_PLATFORM?.trim()
export const auth = shouldUseBrowserLocalAuthPersistence(nativePlatform)
  ? initializeAuth(app, { persistence: browserLocalPersistence })
  : getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export default app
