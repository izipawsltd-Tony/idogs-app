// scripts/test-scan-quota.mjs — behavioral tests for
// api/_lib/scan-quota.js and api/_lib/scan-handler.js (Codex H3: atomic
// AI-scan quota reservation). Exercises the REAL exported functions
// against the in-memory Firestore fake, including a genuine concurrent
// reservation race — not a hand-simulation or source-grep assertion.
//
// Usage: node scripts/test-scan-quota.mjs

import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { reserveScanQuota, rollbackScanReservation } from '../api/_lib/scan-quota.js'
import { createScanHandler } from '../api/_lib/scan-handler.js'
import { SCAN_QUOTA } from '../api/_lib/entitlements.js'

const { check, checkAsync, summary } = makeChecker()

// ── reserveScanQuota — Free lifetime ──────────────────────────────────

await checkAsync('Free account with 0 used: reservation succeeds, freeScansUsed becomes 1', async () => {
  const db = createFakeFirestore({ users: { u1: { plan: 'free', freeScansUsed: 0 } } })
  const userRef = db.collection('users').doc('u1')
  const result = await reserveScanQuota(db, userRef)
  const after = (await userRef.get()).data()
  return result.reserved === true && result.plan === 'free' && after.freeScansUsed === 1
})

await checkAsync(`Free account with ${SCAN_QUOTA.freeLifetime} used (exhausted): reservation fails, count unchanged`, async () => {
  const db = createFakeFirestore({ users: { u1: { plan: 'free', freeScansUsed: SCAN_QUOTA.freeLifetime } } })
  const userRef = db.collection('users').doc('u1')
  const result = await reserveScanQuota(db, userRef)
  const after = (await userRef.get()).data()
  return result.reserved === false && result.plan === 'free' && after.freeScansUsed === SCAN_QUOTA.freeLifetime
})

// ── reserveScanQuota — Plus monthly ───────────────────────────────────

await checkAsync('Plus account with 9/10 used this period: reservation succeeds, becomes 10', async () => {
  const db = createFakeFirestore({
    users: { u1: { plan: 'plus', plusScansUsed: 9, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 } },
  })
  const userRef = db.collection('users').doc('u1')
  const result = await reserveScanQuota(db, userRef)
  const after = (await userRef.get()).data()
  return result.reserved === true && result.plan === 'plus' && after.plusScansUsed === 10
})

await checkAsync(`Plus account with ${SCAN_QUOTA.plusMonthly}/${SCAN_QUOTA.plusMonthly} used this period: reservation fails`, async () => {
  const db = createFakeFirestore({
    users: { u1: { plan: 'plus', plusScansUsed: SCAN_QUOTA.plusMonthly, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 } },
  })
  const userRef = db.collection('users').doc('u1')
  const result = await reserveScanQuota(db, userRef)
  const after = (await userRef.get()).data()
  return result.reserved === false && after.plusScansUsed === SCAN_QUOTA.plusMonthly
})

// ── Codex H3: concurrency — only ONE of two simultaneous reservations
// succeeds when exactly one unit remains ────────────────────────────────

await checkAsync('CONCURRENCY: with 1 scan remaining, two simultaneous reservations result in exactly ONE success and ONE failure — never both succeeding', async () => {
  const db = createFakeFirestore({ users: { u1: { plan: 'free', freeScansUsed: SCAN_QUOTA.freeLifetime - 1 } } })
  const userRef = db.collection('users').doc('u1')
  const [r1, r2] = await Promise.all([
    reserveScanQuota(db, userRef),
    reserveScanQuota(db, userRef),
  ])
  const after = (await userRef.get()).data()
  const successes = [r1, r2].filter(r => r.reserved === true).length
  return successes === 1 && after.freeScansUsed === SCAN_QUOTA.freeLifetime
})

await checkAsync('CONCURRENCY: with 2 scans remaining, three simultaneous reservations result in exactly TWO successes and ONE failure', async () => {
  const db = createFakeFirestore({ users: { u1: { plan: 'free', freeScansUsed: SCAN_QUOTA.freeLifetime - 2 } } })
  const userRef = db.collection('users').doc('u1')
  const results = await Promise.all([
    reserveScanQuota(db, userRef),
    reserveScanQuota(db, userRef),
    reserveScanQuota(db, userRef),
  ])
  const after = (await userRef.get()).data()
  const successes = results.filter(r => r.reserved === true).length
  return successes === 2 && after.freeScansUsed === SCAN_QUOTA.freeLifetime
})

await checkAsync('CONCURRENCY: Plus account, 2 remaining, 5 simultaneous requests — exactly 2 succeed, never over-granting', async () => {
  const db = createFakeFirestore({
    users: { u1: { plan: 'plus', plusScansUsed: SCAN_QUOTA.plusMonthly - 2, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 } },
  })
  const userRef = db.collection('users').doc('u1')
  const results = await Promise.all(Array.from({ length: 5 }, () => reserveScanQuota(db, userRef)))
  const after = (await userRef.get()).data()
  const successes = results.filter(r => r.reserved === true).length
  return successes === 2 && after.plusScansUsed === SCAN_QUOTA.plusMonthly
})

// ── rollbackScanReservation ────────────────────────────────────────────

await checkAsync('rollback decrements freeScansUsed by exactly 1 after a failed scan', async () => {
  const db = createFakeFirestore({ users: { u1: { plan: 'free', freeScansUsed: 1 } } })
  const userRef = db.collection('users').doc('u1')
  await rollbackScanReservation(db, userRef, 'free')
  const after = (await userRef.get()).data()
  return after.freeScansUsed === 0
})

await checkAsync('rollback never goes below 0 even if called with a corrupted/already-0 count', async () => {
  const db = createFakeFirestore({ users: { u1: { plan: 'free', freeScansUsed: 0 } } })
  const userRef = db.collection('users').doc('u1')
  await rollbackScanReservation(db, userRef, 'free')
  const after = (await userRef.get()).data()
  return after.freeScansUsed === 0
})

await checkAsync('rollback decrements plusScansUsed and matches the reservation\'s periodStart', async () => {
  const db = createFakeFirestore({
    users: { u1: { plan: 'plus', plusScansUsed: 5, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 } },
  })
  const userRef = db.collection('users').doc('u1')
  await rollbackScanReservation(db, userRef, 'plus', '2026-07-01T00:00:00.000Z')
  const after = (await userRef.get()).data()
  return after.plusScansUsed === 4
})

await checkAsync('rollback SKIPS decrementing if the period has since rolled over (would otherwise wrongly reduce new-period usage)', async () => {
  const db = createFakeFirestore({
    // Period already rolled to August — the OLD reservation (against the
    // July period) is implicitly gone; decrementing "plusScansUsed" now
    // would incorrectly reduce genuine August usage.
    users: { u1: { plan: 'plus', plusScansUsed: 3, plusScansPeriodStart: '2026-08-01T00:00:00.000Z', scanPeriodAnchorDay: 1 } },
  })
  const userRef = db.collection('users').doc('u1')
  await rollbackScanReservation(db, userRef, 'plus', '2026-07-01T00:00:00.000Z')
  const after = (await userRef.get()).data()
  return after.plusScansUsed === 3
})

// ── createScanHandler — control flow ──────────────────────────────────

function makeRes() {
  const res = { statusCode: null, body: null, status(c) { res.statusCode = c; return res }, json(b) { res.body = b; return res } }
  return res
}

function makeHandler({ identity = { uid: 'u1' }, tokenError = null, reserveResult = { reserved: true, plan: 'free' }, modelResult = { ok: true, extracted: { documentType: 'other' } }, modelThrows = null } = {}) {
  const calls = { verifyIdToken: [], reserveQuota: [], rollbackQuota: [], callModel: [] }
  const handler = createScanHandler({
    verifyIdToken: async token => {
      calls.verifyIdToken.push(token)
      if (tokenError) throw tokenError
      return identity
    },
    getUserRef: uid => ({ uid }),
    reserveQuota: async userRef => {
      calls.reserveQuota.push(userRef)
      return reserveResult
    },
    rollbackQuota: async (userRef, plan, periodStart) => {
      calls.rollbackQuota.push({ userRef, plan, periodStart })
    },
    callModel: async input => {
      calls.callModel.push(input)
      if (modelThrows) throw modelThrows
      return modelResult
    },
  })
  return { handler, calls }
}

async function invoke(route, { authorization = 'Bearer valid-token', body = { image: 'base64data', mediaType: 'image/jpeg' } } = {}) {
  const res = makeRes()
  await route.handler({ method: 'POST', headers: authorization ? { authorization } : {}, body }, res)
  return res
}

await checkAsync('unauthenticated request is rejected without reserving quota or calling the model', async () => {
  const route = makeHandler()
  // Explicit null (not undefined) — passing `authorization: undefined`
  // would trigger invoke()'s own default-parameter value instead of
  // signaling "no header at all".
  const res = await invoke(route, { authorization: null })
  return res.statusCode === 401 && route.calls.reserveQuota.length === 0 && route.calls.callModel.length === 0
})

await checkAsync('invalid token is rejected without reserving quota or calling the model', async () => {
  const route = makeHandler({ tokenError: new Error('invalid') })
  const res = await invoke(route)
  return res.statusCode === 401 && route.calls.reserveQuota.length === 0 && route.calls.callModel.length === 0
})

await checkAsync('missing image is rejected without reserving quota', async () => {
  const route = makeHandler()
  const res = await invoke(route, { body: {} })
  return res.statusCode === 400 && route.calls.reserveQuota.length === 0
})

await checkAsync('quota exhausted (reserveQuota returns reserved:false): 403, the paid model is NEVER called', async () => {
  const route = makeHandler({ reserveResult: { reserved: false, plan: 'free' } })
  const res = await invoke(route)
  return res.statusCode === 403 && res.body.reason === 'SCAN_QUOTA_EXCEEDED' && route.calls.callModel.length === 0
})

await checkAsync('reservation happens BEFORE the model is called (ordering)', async () => {
  const order = []
  const handler = createScanHandler({
    verifyIdToken: async () => ({ uid: 'u1' }),
    getUserRef: uid => ({ uid }),
    reserveQuota: async () => { order.push('reserve'); return { reserved: true, plan: 'free' } },
    rollbackQuota: async () => { order.push('rollback') },
    callModel: async () => { order.push('model'); return { ok: true, extracted: {} } },
  })
  const res = makeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { image: 'x' } }, res)
  return order.join(',') === 'reserve,model'
})

await checkAsync('successful model response: 200 with the extracted payload, reservation is KEPT (no rollback)', async () => {
  const route = makeHandler({ modelResult: { ok: true, extracted: { documentType: 'vaccine_card' } } })
  const res = await invoke(route)
  return res.statusCode === 200 && res.body.documentType === 'vaccine_card' && route.calls.rollbackQuota.length === 0
})

await checkAsync('model returns ok:false (Claude API error): 500, reservation IS rolled back', async () => {
  const route = makeHandler({
    reserveResult: { reserved: true, plan: 'plus', periodStart: '2026-07-01T00:00:00.000Z' },
    modelResult: { ok: false, status: 500, details: { error: 'upstream failure' } },
  })
  const res = await invoke(route)
  return res.statusCode === 500 &&
    route.calls.rollbackQuota.length === 1 &&
    route.calls.rollbackQuota[0].plan === 'plus' &&
    route.calls.rollbackQuota[0].periodStart === '2026-07-01T00:00:00.000Z'
})

await checkAsync('the model call THROWING (network failure): 500, reservation IS rolled back', async () => {
  const route = makeHandler({
    reserveResult: { reserved: true, plan: 'free' },
    modelThrows: new Error('simulated network failure'),
  })
  const res = await invoke(route)
  return res.statusCode === 500 && route.calls.rollbackQuota.length === 1 && route.calls.rollbackQuota[0].plan === 'free'
})

await checkAsync('a raw-text-fallback extraction (JSON parse failed but the model DID respond) still counts as success — no rollback', async () => {
  const route = makeHandler({ modelResult: { ok: true, extracted: { documentType: 'other', vaccines: [], healthTests: [], raw: 'unparseable text' } } })
  const res = await invoke(route)
  return res.statusCode === 200 && route.calls.rollbackQuota.length === 0
})

await summary()
