import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { app, auth, useEmulators } from './firebaseApp'

export { auth }
export const db = getFirestore(app)
export const storage = getStorage(app)

// CI journey E2E only (e2e/journey): a build made with VITE_FIREBASE_EMULATOR=1
// AND served from localhost talks to the local Firebase emulators. Production
// and Preview builds never set the flag, so this is dead code there.
if (useEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080)
export default app
