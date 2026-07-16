// Shared emulator-only Admin SDK bootstrap for scripts/test-*.mjs.
//
// firebase-admin's cert() requires PEM/PKCS8-shaped values to construct,
// but every test importing this talks exclusively to local Firebase
// emulators (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST),
// which never validate credentials or signatures — cert() only needs
// something structurally valid. Generating a fresh disposable RSA key
// per process run (instead of a fixed key committed to the repo) means
// no key material is ever committed, logged, printed, or written to
// disk — it lives only in this process's memory for the run's duration.
import { generateKeyPairSync } from 'node:crypto'

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-idogs-qa'
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@demo-idogs-qa.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey
