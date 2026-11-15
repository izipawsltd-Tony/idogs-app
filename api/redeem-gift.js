// api/redeem-gift.js — authenticated kennel-gift claim (one free year of
// iDogs Plus). Logic and safety gates live in _lib/gift-redeem-handler.js.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createGiftRedeemHandler } from './_lib/gift-redeem-handler.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const db = getFirestore()

export default createGiftRedeemHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  db,
  // 5 attempts per 15 minutes per account: blunts code guessing.
  checkRateLimit: hashedUid => checkDurableRateLimit(db, 'gift-redeem', hashedUid, 15 * 60_000, 5),
})
