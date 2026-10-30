import { randomUUID } from 'node:crypto'

export const DELETION_LOCKS = 'accountDeletionLocks'
export const MUTATION_LEASES = 'accountMutationLeases'
export const DELETION_JOBS = 'accountDeletionJobs'
export const DELETION_RECEIPTS = 'accountDeletionReceipts'
export const validAccountId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const denied = code => Object.assign(new Error(code), { status: 423, code })

// Returning from a signer is not evidence that the issued write authority has
// drained. Until a separately verified grant protocol exists, these prototype
// issuers retain their original durable lease even on errors or early returns.
// Grant status, object absence and URL expiry alone cannot release this hold.
const EXTERNAL_WRITE_AUTHORITY_ROUTES = new Set([
  'api/request-showcase-media-upload.js',
  'api/request-landing-media-upload.js',
])

// This increment is deliberately not a cloud activation mechanism. All three
// emulators, a demo project, explicit opt-in and matching injected services are
// required. A copied environment flag must never enable a real deletion.
export function requireDeletionEmulators({ projectId, db, auth, bucket, env = process.env }) {
  if (env.ACCOUNT_DELETION_MODE !== 'prototype-emulator'
    || !/^demo-[a-z0-9-]{1,24}$/.test(projectId || '')
    || env.GCLOUD_PROJECT !== projectId
    || (env.FIREBASE_PROJECT_ID && env.FIREBASE_PROJECT_ID !== projectId)
    || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_PRIVATE_KEY || env.FIREBASE_CLIENT_EMAIL) {
    throw denied('DELETION_EMULATOR_ONLY')
  }
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):[1-9][0-9]{3,4}$/.test(env[key] || '')) throw denied('DELETION_EMULATOR_ONLY')
  }
  if (db?.projectId !== projectId || auth?.app?.options?.projectId !== projectId
    || bucket?.name !== `${projectId}.firebasestorage.app`) throw denied('DELETION_SERVICE_MISMATCH')
}

export async function assertAccountWritableTx(tx, db, uid) {
  if (!validAccountId(uid)) throw denied('INVALID_MUTATION_ACCOUNT')
  // Any lock, including a completed tombstone or malformed lock, fails closed.
  if ((await tx.get(db.collection(DELETION_LOCKS).doc(uid))).exists) throw denied('ACCOUNT_DELETION_LOCKED')
}

// Route transactions must re-read locks after the outer ingress lease. This
// stays strictly emulator-only; ordinary deployments retain existing behavior.
export async function assertPrototypeAccountLocksTx(tx, db, accounts) {
  if (process.env.ACCOUNT_DELETION_MODE !== 'prototype-emulator') return
  const [{ getAuth }, { getStorage }] = await Promise.all([
    import('firebase-admin/auth'), import('firebase-admin/storage'),
  ])
  const auth = getAuth(), projectId = auth.app.options.projectId
  requireDeletionEmulators({ projectId, db, auth, bucket: getStorage().bucket(`${projectId}.firebasestorage.app`) })
  if (!Array.isArray(accounts) || !accounts.length || accounts.length > 200 || accounts.some(uid => !validAccountId(uid))) throw denied('INVALID_MUTATION_SCOPE')
  for (const uid of [...new Set(accounts)].sort()) await assertAccountWritableTx(tx, db, uid)
}
export async function beginAccountMutation(db, accounts, operation = 'account-mutation') {
  const uids = [...new Set(accounts)].sort()
  if (!uids.length || uids.length > 200 || uids.some(uid => !validAccountId(uid))) throw denied('INVALID_MUTATION_SCOPE')
  const ref = db.collection(MUTATION_LEASES).doc(randomUUID())
  await db.runTransaction(async tx => {
    for (const uid of uids) await assertAccountWritableTx(tx, db, uid)
    tx.create(ref, { uids, operation: String(operation).slice(0,100), state: 'active', startedAt: new Date().toISOString() })
  })
  return async () => {
    // No timeout-based expiry: a crashed writer is an explicit processing hold,
    // never evidence that its un-awaited external write has stopped.
    await ref.update({ state: 'closed', closedAt: new Date().toISOString() })
  }
}

export async function withAccountMutation(db, accounts, operation, fn) {
  const close = await beginAccountMutation(db, accounts, operation)
  try { return await fn() } finally { await close() }
}

// Prototype ingress fence. Normal deployments are unchanged and cannot run the
// emulator-only processor. Before any future cloud activation this deliberately
// conservative resolver needs a separately reviewed, scalable per-route rollout.
export function withAccountMutationFence(handler, { route }) {
  return async (req, res) => {
    if (process.env.ACCOUNT_DELETION_MODE !== 'prototype-emulator') return handler(req, res)
    // This route verifies its signature before resolving its exact account scope.
    if (route === 'api/stripe-webhook.js') return handler(req, res)
    let close
    try {
      const [{ getAuth }, { getFirestore }, { getApp }, { getStorage }] = await Promise.all([
        import('firebase-admin/auth'), import('firebase-admin/firestore'), import('firebase-admin/app'), import('firebase-admin/storage'),
      ])
      const projectId = getApp().options.projectId
      const db = getFirestore(), auth = getAuth(), bucket = getStorage().bucket(`${projectId}.firebasestorage.app`)
      requireDeletionEmulators({ projectId, db, auth, bucket })
      const header = req.headers?.authorization || ''
      const accounts = new Set()
      let token
      if (header.startsWith('Bearer ')) {
        token = await auth.verifyIdToken(header.slice(7), true)
        accounts.add(token.uid)
      } else if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
        // Anonymous/provider/cron writers are conservatively drained globally
        // in this synthetic prototype. No provider signature/auth is bypassed:
        // the original handler still performs its own checks after the lease.
        const users = await db.collection('users').limit(201).get()
        if (users.size > 200) throw denied('MUTATION_SCOPE_REQUIRES_REVIEW')
        for (const user of users.docs) accounts.add(user.id)
        if (!accounts.size) throw denied('MUTATION_SCOPE_UNRESOLVED')
      } else return handler(req, res)
      if (validAccountId(req.query?.uid)) accounts.add(req.query.uid)
      let body = req.body || {}
      if (typeof body === 'string') { try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'Malformed JSON body' }) } }
      const dogIds = [body.dogId, req.query?.dogId, ...(Array.isArray(body.puppyIds) ? body.puppyIds : [])]
      const litterId = body.litterId || req.query?.litterId
      if (typeof litterId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(litterId)) {
        const litter = await db.collection('litters').doc(litterId).get()
        if (validAccountId(litter.data()?.tenantId)) accounts.add(litter.data().tenantId)
      }
      if (route === 'api/claim-transferred-dogs.js' && token?.email) {
        const dogs = await db.collection('dogs').where('buyerEmail','==',token.email.toLowerCase()).where('status','==','transferred').limit(201).get()
        if (dogs.size > 200) throw denied('MUTATION_SCOPE_REQUIRES_REVIEW')
        dogIds.push(...dogs.docs.map(d => d.id))
      }
      for (const dogId of dogIds.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) {
        const dog = await db.collection('dogs').doc(dogId).get()
        const uid = dog.data()?.currentOwnerId || dog.data()?.tenantId
        if (validAccountId(uid)) accounts.add(uid)
      }
      close = await beginAccountMutation(db, [...accounts], route)
      return await handler(req, res)
    } catch (error) {
      if (!res.headersSent) return res.status(error.status || 503).json({ error: 'Account changes are unavailable while deletion safety checks are active.', code: error.status === 423 ? error.code : 'MUTATION_FENCE_UNAVAILABLE' })
    } finally {
      if (close && !EXTERNAL_WRITE_AUTHORITY_ROUTES.has(route)) { try { await close() } catch { console.error('Account mutation lease could not be closed; deletion remains held') } }
    }
  }
}
