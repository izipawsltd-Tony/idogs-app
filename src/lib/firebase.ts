import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Firebase SDK init throws synchronously (e.g. auth/invalid-api-key) when this
// config is missing, which happens before React ever mounts — an uncaught
// throw here otherwise leaves a permanently blank white page with no visible
// clue why. Replace the page with a readable message first so a misconfigured
// deployment (missing VITE_FIREBASE_* env vars) is obvious instead of silent.
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  document.body.innerHTML = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 32px; text-align: center; color: #1a3a2a;">
      <h1 style="font-size: 20px; margin-bottom: 12px;">Configuration Error</h1>
      <p style="color: #53635a; font-size: 14px; line-height: 1.6;">
        This deployment is missing its Firebase environment variables (VITE_FIREBASE_*).
        Contact the administrator — this is a deployment configuration issue, not a data problem.
      </p>
    </div>`
  throw new Error('Firebase configuration is missing required environment variables (VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID).')
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export default app