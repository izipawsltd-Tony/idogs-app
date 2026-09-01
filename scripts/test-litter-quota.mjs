// Regression tests for Plus 2-litter rolling quota + one-time Extra Litter credits.
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import {
  LITTER_INCLUDED_QUOTA,
  isWithinRollingWindow,
  litterUsageWithinRollingWindow,
  decideLitterQuotaTx,
  consumeExtraLitterCredit,
  writeLitterQuotaLedgerEntry,
  hasOtherUndatedPlannedLitter,
} from '../api/_lib/litter-quota.js'

const { check, checkAsync, summary } = makeChecker()

check('Plus included litter limit is 2', LITTER_INCLUDED_QUOTA === 2)
check('same date is inside rolling window', isWithinRollingWindow('2026-07-24', '2026-07-24'))
check('365-day boundary is inclusive', isWithinRollingWindow('2025-07-24', '2026-07-24'))
check('366 days is outside rolling window', !isWithinRollingWindow('2025-07-23', '2026-07-24'))
check('backdating cannot evade symmetric window', isWithinRollingWindow('2027-03-01', '2027-01-10'))

await checkAsync('0 recent litters -> first included litter allowed', async () => {
  const db = createFakeFirestore({})
  const decision = await db.runTransaction(tx => decideLitterQuotaTx(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
  }))
  return decision.allowed && decision.quotaSource === 'included' && decision.usage.includedUsed === 0
})

await checkAsync('1 recent included litter -> second included litter allowed', async () => {
  const db = createFakeFirestore({ litterQuotaLedger: {
    e1: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l1', whelpingDate: '2026-03-01', quotaSource: 'included' },
  } })
  const decision = await db.runTransaction(tx => decideLitterQuotaTx(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
  }))
  return decision.allowed && decision.quotaSource === 'included' && decision.usage.includedUsed === 1
})

await checkAsync('2 recent included litters -> third blocked without credit', async () => {
  const db = createFakeFirestore({ litterQuotaLedger: {
    e1: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l1', whelpingDate: '2026-02-01', quotaSource: 'included' },
    e2: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l2', whelpingDate: '2026-05-01', quotaSource: 'included' },
  } })
  const decision = await db.runTransaction(tx => decideLitterQuotaTx(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
  }))
  return !decision.allowed && decision.usage.includedUsed === 2
})

await checkAsync('available A$39 credit allows third litter and is selected', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: {
      e1: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l1', whelpingDate: '2026-02-01', quotaSource: 'included' },
      e2: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l2', whelpingDate: '2026-05-01', quotaSource: 'included' },
    },
    litterQuotaCredits: {
      cs_1: { breederProfileId: 'bp_a', purchasedByUid: 'u1', status: 'available', purchasedAt: '2026-08-31T00:00:00.000Z' },
    },
  })
  const decision = await db.runTransaction(tx => decideLitterQuotaTx(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
  }))
  return decision.allowed && decision.quotaSource === 'extra' && decision.credit?.id === 'cs_1'
})

await checkAsync('credit consumption + extra ledger are atomic from caller perspective', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: {
      e1: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l1', whelpingDate: '2026-02-01', quotaSource: 'included' },
      e2: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l2', whelpingDate: '2026-05-01', quotaSource: 'included' },
    },
    litterQuotaCredits: {
      cs_1: { breederProfileId: 'bp_a', purchasedByUid: 'u1', status: 'available', purchasedAt: '2026-08-31T00:00:00.000Z' },
    },
  })
  await db.runTransaction(async tx => {
    const decision = await decideLitterQuotaTx(tx, db, {
      breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
    })
    if (!decision.allowed || !decision.credit) throw new Error('expected credit')
    consumeExtraLitterCredit(tx, decision.credit, { litterId: 'l3', consumedAt: '2026-09-01T00:00:00.000Z' })
    writeLitterQuotaLedgerEntry(tx, db, {
      tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l3', whelpingDate: '2026-09-01', quotaSource: 'extra', extraCreditId: decision.credit.id,
    })
  })
  const credit = db._dump('litterQuotaCredits').cs_1
  const ledger = Object.values(db._dump('litterQuotaLedger')).find(x => x.litterId === 'l3')
  return credit.status === 'consumed' && credit.consumedByLitterId === 'l3' && ledger?.quotaSource === 'extra' && ledger?.extraCreditId === 'cs_1'
})

await checkAsync('one consumed credit cannot fund a fourth litter', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: {
      e1: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l1', whelpingDate: '2026-02-01', quotaSource: 'included' },
      e2: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l2', whelpingDate: '2026-05-01', quotaSource: 'included' },
      e3: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l3', whelpingDate: '2026-07-01', quotaSource: 'extra', extraCreditId: 'cs_1' },
    },
    litterQuotaCredits: {
      cs_1: { breederProfileId: 'bp_a', purchasedByUid: 'u1', status: 'consumed', consumedByLitterId: 'l3' },
    },
  })
  const decision = await db.runTransaction(tx => decideLitterQuotaTx(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
  }))
  return !decision.allowed && decision.usage.includedUsed === 2 && decision.usage.extraUsed === 1
})

await checkAsync('extra litter does not steal either of the two included slots', async () => {
  const db = createFakeFirestore({ litterQuotaLedger: {
    e1: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'l1', whelpingDate: '2026-03-01', quotaSource: 'included' },
    e2: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'lX', whelpingDate: '2026-04-01', quotaSource: 'extra', extraCreditId: 'cs_x' },
  } })
  const decision = await db.runTransaction(tx => decideLitterQuotaTx(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], purchasedByUid: 'u1', newDate: '2026-09-01',
  }))
  return decision.allowed && decision.quotaSource === 'included' && decision.usage.includedUsed === 1 && decision.usage.extraUsed === 1
})

await checkAsync('new account with same breederProfileId sees old account ledger', async () => {
  const db = createFakeFirestore({ litterQuotaLedger: {
    e1: { tenantId: 'oldUid', breederProfileId: 'bp_shared', litterId: 'l1', whelpingDate: '2026-02-01', quotaSource: 'included' },
    e2: { tenantId: 'oldUid', breederProfileId: 'bp_shared', litterId: 'l2', whelpingDate: '2026-05-01', quotaSource: 'included' },
  } })
  const usage = await db.runTransaction(tx => litterUsageWithinRollingWindow(tx, db, {
    breederProfileId: 'bp_shared', tenantIds: ['newUid'], newDate: '2026-09-01',
  }))
  return usage.includedUsed === 2
})

await checkAsync('legacy pre-ledger live litters still count', async () => {
  const db = createFakeFirestore({ litters: {
    legacy1: { tenantId: 'oldUid', actualBirthDate: '2026-02-01', archived: true },
    legacy2: { tenantId: 'oldUid', actualBirthDate: '2026-05-01', archived: false },
  } })
  const usage = await db.runTransaction(tx => litterUsageWithinRollingWindow(tx, db, {
    breederProfileId: 'bp_shared', tenantIds: ['oldUid', 'newUid'], newDate: '2026-09-01',
  }))
  return usage.includedUsed === 2
})

await checkAsync('litter outside 365-day window releases included capacity', async () => {
  const db = createFakeFirestore({ litterQuotaLedger: {
    old: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'old', whelpingDate: '2025-08-30', quotaSource: 'included' },
    recent: { tenantId: 'u1', breederProfileId: 'bp_a', litterId: 'recent', whelpingDate: '2026-06-01', quotaSource: 'included' },
  } })
  const usage = await db.runTransaction(tx => litterUsageWithinRollingWindow(tx, db, {
    breederProfileId: 'bp_a', tenantIds: ['u1'], newDate: '2026-09-01',
  }))
  return usage.includedUsed === 1
})

await checkAsync('planned litter cap spans related tenant UIDs', async () => {
  const db = createFakeFirestore({ litters: {
    planned: { tenantId: 'oldUid', actualBirthDate: '', archived: false },
  } })
  const hit = await db.runTransaction(tx => hasOtherUndatedPlannedLitter(tx, db, ['oldUid', 'newUid']))
  return hit === true
})

await summary()
