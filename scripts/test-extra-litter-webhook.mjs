import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { breederIdentity } from '../api/_lib/breeder-profile.js'
import { grantExtraLitterCreditFromVerifiedEvent } from '../api/_lib/extra-litter-webhook.js'

const { checkAsync, summary } = makeChecker()

const profile = {
  email: 'breeder@example.com',
  breederIdType: 'DACO_SA',
  breederIdValue: 'DACO123',
  stripeCustomerId: 'cus_1',
}
const breederProfileId = breederIdentity(profile, { uid: 'u1' }).breederProfileId

function event(overrides = {}) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_1',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 3900,
      currency: 'aud',
      customer: 'cus_1',
      payment_intent: 'pi_1',
      metadata: { purchaseType: 'extra_litter', userId: 'u1', breederProfileId },
      ...overrides,
    } },
  }
}

await checkAsync('paid A$39 session grants exactly one available credit', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  const result = await grantExtraLitterCreditFromVerifiedEvent({ db, event: event(), now: () => new Date('2026-09-01T00:00:00Z') })
  const credit = db._dump('litterQuotaCredits').cs_1
  return result.handled && result.created && credit?.status === 'available' && credit?.amountAudCents === 3900 && credit?.breederProfileId === breederProfileId
})

await checkAsync('same Checkout Session retry does not double-credit', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  await grantExtraLitterCreditFromVerifiedEvent({ db, event: event() })
  const second = await grantExtraLitterCreditFromVerifiedEvent({ db, event: { ...event(), id: 'evt_retry' } })
  return second.handled && second.created === false && Object.keys(db._dump('litterQuotaCredits')).length === 1
})

await checkAsync('unpaid session is rejected', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  try {
    await grantExtraLitterCreditFromVerifiedEvent({ db, event: event({ payment_status: 'unpaid' }) })
    return false
  } catch (err) {
    return err.message === 'INVALID_EXTRA_LITTER_CHECKOUT' && Object.keys(db._dump('litterQuotaCredits')).length === 0
  }
})

await checkAsync('wrong amount is rejected', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  try {
    await grantExtraLitterCreditFromVerifiedEvent({ db, event: event({ amount_total: 1 }) })
    return false
  } catch (err) {
    return err.message === 'INVALID_EXTRA_LITTER_CHECKOUT'
  }
})

await checkAsync('wrong customer is rejected', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  try {
    await grantExtraLitterCreditFromVerifiedEvent({ db, event: event({ customer: 'cus_attacker' }) })
    return false
  } catch (err) {
    return err.message === 'EXTRA_LITTER_CUSTOMER_MISMATCH'
  }
})

await checkAsync('forged breederProfileId is rejected', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  try {
    await grantExtraLitterCreditFromVerifiedEvent({ db, event: event({ metadata: { purchaseType: 'extra_litter', userId: 'u1', breederProfileId: `bp_${'a'.repeat(32)}` } }) })
    return false
  } catch (err) {
    return err.message === 'EXTRA_LITTER_BREEDER_PROFILE_MISMATCH'
  }
})

await checkAsync('unrelated Stripe event is a no-op', async () => {
  const db = createFakeFirestore({ users: { u1: profile } })
  const result = await grantExtraLitterCreditFromVerifiedEvent({ db, event: { id: 'evt_x', type: 'invoice.paid', data: { object: {} } } })
  return result.handled === false && Object.keys(db._dump('litterQuotaCredits')).length === 0
})

await summary()
