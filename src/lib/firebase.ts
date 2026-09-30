import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { resolveNativePlatform, shouldUseBrowserLocalAuthPersistence, type CapacitorRuntimeLike } from './nativeAuthPersistence'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

type CapacitorWindow = Window & { Capacitor?: CapacitorRuntimeLike }
const capacitor = typeof window === 'undefined' ? undefined : (window as CapacitorWindow).Capacitor
const nativePlatform = resolveNativePlatform(import.meta.env.VITE_IDOGS_NATIVE_PLATFORM, capacitor)

const app = initializeApp(firebaseConfig)
export const auth = shouldUseBrowserLocalAuthPersistence(nativePlatform)
  ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
  : getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export default app
