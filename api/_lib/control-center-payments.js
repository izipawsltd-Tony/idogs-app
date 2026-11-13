// Read-only paid-customer history for the Control Center funnel.
//
// Definitions (docs/CONTROL_CENTER_FUNNEL_DEFINITIONS.md, Owner decision 13 Nov 2026):
// - Paying customer: a successful, not fully refunded Stripe charge with an
//   amount above zero, linked to exactly one iDogs account through its stored
//   stripeCustomerId. Counted once per account, on its first verified payment.
//   Test-mode transactions never count. Apple purchases are not integrated in
//   the iOS app, so they are outside this measurement and reported as such.
// - Paid retention: among accounts whose first paid subscription period has
//   ended (plus a grace period), the share with a later paid subscription
//   invoice (a successful renewal).
// Only aggregate counts leave this module: no customer, charge or invoice IDs.

const DAY = 86400000
const EXCLUDED = new Set(['INTERNAL', 'TEST_QA'])
const SUBSCRIPTION_REASONS = new Set(['subscription_create', 'subscription_cycle'])

const emptyBucket = () => ({ payingAccounts: 0, newPayingAccounts: 0, dueForRenewal: 0, renewed: 0, unknownPeriod: 0 })

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }))
  return results
}

function successfulCharge(charge) {
  return charge?.status === 'succeeded' && charge.paid === true && charge.refunded !== true
    && Number.isSafeInteger(charge.amount_captured) && charge.amount_captured > 0
    && Number.isSafeInteger(charge.created)
}

// Stripe API versions used by stripe-node 22 move the subscription reference
// under invoice.parent; older payloads keep invoice.subscription.
function subscriptionOf(invoice) {
  const ref = invoice?.subscription || invoice?.parent?.subscription_details?.subscription
  const id = typeof ref === 'string' ? ref : ref?.id
  return typeof id === 'string' && id ? id : null
}

// Service period of the subscription being billed: from the earliest start to
// the latest end among non-proration lines. Proration lines describe
// mid-period changes and must not decide when a period starts or ends.
function servicePeriod(invoice) {
  const lines = (Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [])
    .filter(line => line?.proration !== true && line?.parent?.subscription_item_details?.proration !== true)
  const starts = lines.map(line => line?.period?.start).filter(Number.isSafeInteger)
  const ends = lines.map(line => line?.period?.end).filter(Number.isSafeInteger)
  return { start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null }
}

// Stripe starts the next cycle exactly at the previous period end. One day of
// tolerance absorbs clock/anchor rounding while still rejecting a skipped
// period (which starts a whole billing interval later).
const NEXT_PERIOD_TOLERANCE_SECONDS = 86400

function paidSubscriptionInvoices(invoices) {
  return invoices
    .filter(invoice => invoice?.status === 'paid' && Number.isSafeInteger(invoice.amount_paid) && invoice.amount_paid > 0
      && SUBSCRIPTION_REASONS.has(invoice.billing_reason) && Number.isSafeInteger(invoice.created))
    .sort((a, b) => a.created - b.created)
}

export function summarizeCustomerPayments({ charges, invoices, now, windowDays, renewalGraceDays }) {
  const result = {}
  for (const live of [true, false]) {
    const firstCharge = charges.filter(charge => Boolean(charge.livemode) === live && successfulCharge(charge))
      .reduce((min, charge) => Math.min(min, charge.created), Infinity)
    if (firstCharge === Infinity) continue
    const paid = paidSubscriptionInvoices(invoices.filter(invoice => Boolean(invoice.livemode) === live))
    const first = paid[0]
    let renewal = 'NONE'
    if (first) {
      const periodEnd = servicePeriod(first).end
      const subscription = subscriptionOf(first)
      // A renewal is the paid cycle invoice of the SAME subscription for the
      // service period that starts where the first paid period ended. A new
      // subscription after cancelling, another subscription of the customer,
      // or a paid invoice for a later period (the next period was skipped,
      // unpaid or A$0) is not a renewal of the first paid period.
      const renewed = periodEnd !== null && paid.some(invoice => invoice !== first && invoice.created > first.created
        && invoice.billing_reason === 'subscription_cycle' && subscriptionOf(invoice) === subscription
        && Number.isSafeInteger(servicePeriod(invoice).start)
        && Math.abs(servicePeriod(invoice).start - periodEnd) <= NEXT_PERIOD_TOLERANCE_SECONDS)
      if (periodEnd === null || subscription === null) renewal = 'UNKNOWN_PERIOD'
      else if (periodEnd * 1000 + renewalGraceDays * DAY <= now.getTime()) renewal = renewed ? 'RENEWED' : 'DUE_NOT_RENEWED'
      else renewal = 'NOT_DUE'
    }
    result[live ? 'live' : 'test'] = {
      firstPaymentAt: firstCharge * 1000,
      newInWindow: firstCharge * 1000 >= now.getTime() - windowDays * DAY && firstCharge * 1000 <= now.getTime(),
      renewal,
    }
  }
  return result
}

export async function compilePaymentHistory({
  stripe, users, accounts, stripeMode, now = new Date(), windowDays = 30,
  maxCustomers = 100, concurrency = 5, renewalGraceDays = 3,
}) {
  const base = {
    windowDays,
    sources: { stripe: 'UNAVAILABLE', apple: 'NOT_INTEGRATED' },
    scope: 'Stripe only. The iOS app does not sell subscriptions through Apple In-App Purchase, so Apple transactions are outside this count.',
    live: null,
    test: null,
    linkedAccounts: 0,
    ambiguousCustomers: 0,
    failedCustomerReads: 0,
  }
  if (!stripe) return { ...base, status: 'UNAVAILABLE' }
  const classification = new Map(accounts.map(account => [account.uid, account.classification]))
  const byCustomer = new Map()
  for (const user of users) {
    const customer = user.stripeCustomerId
    if (typeof customer !== 'string' || !customer.startsWith('cus_')) continue
    if (EXCLUDED.has(classification.get(user.id))) continue
    byCustomer.set(customer, (byCustomer.get(customer) || 0) + 1)
  }
  // One Stripe customer stored on two accounts cannot be attributed to one.
  const customers = [...byCustomer].filter(([, count]) => count === 1).map(([customer]) => customer)
  base.ambiguousCustomers = byCustomer.size - customers.length
  base.linkedAccounts = customers.length
  if (customers.length > maxCustomers) return { ...base, sources: { ...base.sources, stripe: 'PARTIAL' }, status: 'PARTIAL' }

  const reads = await mapLimited(customers, concurrency, async customer => {
    try {
      const [charges, invoices] = await Promise.all([
        stripe.charges.list({ customer, limit: 100 }),
        stripe.invoices.list({ customer, status: 'paid', limit: 100 }),
      ])
      // Lists are newest-first; a truncated list could hide the first payment.
      if (charges.has_more || invoices.has_more) return null
      return summarizeCustomerPayments({ charges: charges.data, invoices: invoices.data, now, windowDays, renewalGraceDays })
    } catch {
      return null
    }
  })
  const live = emptyBucket(), test = emptyBucket()
  for (const read of reads) {
    if (!read) { base.failedCustomerReads++; continue }
    for (const [bucket, summary] of [[live, read.live], [test, read.test]]) {
      if (!summary) continue
      bucket.payingAccounts++
      if (summary.newInWindow) bucket.newPayingAccounts++
      if (summary.renewal === 'RENEWED') { bucket.dueForRenewal++; bucket.renewed++ }
      if (summary.renewal === 'DUE_NOT_RENEWED') bucket.dueForRenewal++
      if (summary.renewal === 'UNKNOWN_PERIOD') bucket.unknownPeriod++
    }
  }
  const complete = base.failedCustomerReads === 0 && base.ambiguousCustomers === 0
  const status = !complete ? 'PARTIAL' : stripeMode === 'LIVE' ? 'VERIFIED' : stripeMode === 'TEST' ? 'TEST_MODE_ONLY' : 'UNKNOWN_MODE'
  return {
    ...base,
    status,
    sources: { ...base.sources, stripe: complete ? 'COMPLETE' : 'PARTIAL' },
    // LIVE counts are only certified when every linked customer was read and
    // the key itself is LIVE. Test-mode counts are diagnostics for staging QA.
    live: status === 'VERIFIED' ? live : null,
    test,
  }
}
