import Stripe from 'stripe'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { CHECKOUT_PRICE_IDS } from './checkout-handler.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from './entitlements.js'
import { ALLOWED_ADMINS } from '../super-admin/_auth.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SUPPORT_NEEDS_ACTION = new Set(['new', 'open', 'waiting_for_support'])
const TEST_TOKENS = /(^|[^a-z0-9])(qa|test|testing|staging|preview|demo|sandbox)([^a-z0-9]|$)/i
const TEST_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test.com', 'invalid'])
const CONFIDENCE_WEIGHT = Object.freeze({ HIGH: 1, MEDIUM: 0.75, LOW: 0.5 })

function toDate(value) {
  if (!value) return new Date(0)
  if (typeof value.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

function percentage(numerator, denominator) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function ageDays(value, now) {
  const date = toDate(value)
  if (date.getTime() <= 0) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS))
}

function mapIncrement(map, key, amount = 1) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + amount)
}

function priceToMonthlyCents(price, quantity = 1) {
  if (!price?.recurring || typeof price.unit_amount !== 'number') return null
  const intervalCount = Math.max(1, Number(price.recurring.interval_count) || 1)
  const amount = price.unit_amount * Math.max(1, Number(quantity) || 1)
  switch (price.recurring.interval) {
    case 'month': return amount / intervalCount
    case 'year': return amount / (12 * intervalCount)
    case 'week': return amount * (52 / 12) / intervalCount
    case 'day': return amount * (365.25 / 12) / intervalCount
    default: return null
  }
}

function subscriptionMonthlyTruth(subscription) {
  const totals = new Map()
  const lines = []
  for (const item of subscription?.items?.data || []) {
    const price = item.price
    const monthlyCents = priceToMonthlyCents(price, item.quantity || 1)
    const currency = String(price?.currency || '').toLowerCase()
    if (monthlyCents === null || !currency) continue
    mapIncrement(totals, currency, monthlyCents)
    lines.push({
      priceId: price.id,
      currency: currency.toUpperCase(),
      monthlyAmount: roundMoney(monthlyCents / 100),
      interval: price.recurring?.interval || null,
      intervalCount: price.recurring?.interval_count || 1,
      quantity: item.quantity || 1,
    })
  }
  return { totals, lines }
}

function priceSummary(price) {
  if (!price) return null
  return {
    id: price.id,
    active: price.active,
    livemode: Boolean(price.livemode),
    currency: String(price.currency || '').toUpperCase(),
    amount: typeof price.unit_amount === 'number' ? roundMoney(price.unit_amount / 100) : null,
    interval: price.recurring?.interval || null,
    intervalCount: price.recurring?.interval_count || 1,
  }
}

async function compileRevenueTruth(users) {
  const legacyStoredEstimateAud = users.reduce((sum, user) => {
    const storedActive = user.subscriptionStatus === 'active' && user.stripeSubscriptionId && user.plan === 'plus'
    if (!storedActive) return sum
    return sum + (user.billingInterval === 'annual' ? 49 / 12 : 5)
  }, 0)

  const result = {
    status: 'UNAVAILABLE',
    stripeMode: 'UNKNOWN',
    verifiedLiveMrrAud: 0,
    verifiedTestMrrAud: 0,
    verifiedLiveActiveSubscriptions: 0,
    verifiedTestActiveSubscriptions: 0,
    trialingSubscriptions: 0,
    pastDueSubscriptions: 0,
    canceledSubscriptions: 0,
    storedSubscriptionProfiles: users.filter(user => Boolean(user.stripeSubscriptionId)).length,
    uniqueStoredSubscriptionIds: 0,
    retrievedSubscriptions: 0,
    failedSubscriptionReads: 0,
    nonAudRecurring: [],
    canonicalPrices: { monthly: null, annual: null },
    legacyStoredEstimateAud: roundMoney(legacyStoredEstimateAud),
    legacyDeltaAud: null,
    note: '',
    subscriptionsById: {},
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    result.note = 'STRIPE_SECRET_KEY is unavailable in this environment. Revenue is not verified.'
    return result
  }

  const stripe = new Stripe(stripeKey)
  const uniqueSubscriptionIds = [...new Set(users.map(user => user.stripeSubscriptionId).filter(Boolean))]
  result.uniqueStoredSubscriptionIds = uniqueSubscriptionIds.length

  let canonicalReads = 0
  try {
    const [monthly, annual] = await Promise.all([
      stripe.prices.retrieve(CHECKOUT_PRICE_IDS.plus_monthly),
      stripe.prices.retrieve(CHECKOUT_PRICE_IDS.plus_annual),
    ])
    result.canonicalPrices = { monthly: priceSummary(monthly), annual: priceSummary(annual) }
    result.stripeMode = monthly.livemode && annual.livemode ? 'LIVE' : (!monthly.livemode && !annual.livemode ? 'TEST' : 'MIXED')
    canonicalReads = 2
  } catch {
    result.note = 'Canonical Stripe Plus prices could not both be verified in this environment.'
  }

  const reads = await Promise.all(uniqueSubscriptionIds.map(async id => {
    try {
      const subscription = await stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] })
      return { id, ok: true, subscription }
    } catch {
      return { id, ok: false, subscription: null }
    }
  }))

  const currencyTotals = new Map()
  for (const read of reads) {
    if (!read.ok || !read.subscription) {
      result.failedSubscriptionReads++
      continue
    }
    result.retrievedSubscriptions++
    const subscription = read.subscription
    const monthly = subscriptionMonthlyTruth(subscription)
    const audCents = monthly.totals.get('aud') || 0
    const otherCurrencies = [...monthly.totals.entries()].filter(([currency]) => currency !== 'aud')
    for (const [currency, cents] of otherCurrencies) mapIncrement(currencyTotals, currency, cents)

    const isActive = subscription.status === 'active'
    if (subscription.status === 'trialing') result.trialingSubscriptions++
    if (subscription.status === 'past_due') result.pastDueSubscriptions++
    if (subscription.status === 'canceled') result.canceledSubscriptions++

    if (isActive && subscription.livemode) {
      result.verifiedLiveActiveSubscriptions++
      result.verifiedLiveMrrAud += audCents / 100
    }
    if (isActive && !subscription.livemode) {
      result.verifiedTestActiveSubscriptions++
      result.verifiedTestMrrAud += audCents / 100
    }

    result.subscriptionsById[read.id] = {
      status: subscription.status,
      livemode: Boolean(subscription.livemode),
      currency: monthly.lines.length === 1 ? monthly.lines[0].currency : 'MIXED',
      mrrAud: roundMoney(audCents / 100),
      lines: monthly.lines,
    }
  }

  result.verifiedLiveMrrAud = roundMoney(result.verifiedLiveMrrAud)
  result.verifiedTestMrrAud = roundMoney(result.verifiedTestMrrAud)
  result.nonAudRecurring = [...currencyTotals.entries()].map(([currency, cents]) => ({ currency: currency.toUpperCase(), monthlyAmount: roundMoney(cents / 100) }))
  result.legacyDeltaAud = roundMoney(result.verifiedLiveMrrAud - result.legacyStoredEstimateAud)

  if (canonicalReads === 2 && result.failedSubscriptionReads === 0) result.status = 'VERIFIED'
  else if (canonicalReads > 0 || result.retrievedSubscriptions > 0) result.status = 'PARTIAL'
  else result.status = 'UNAVAILABLE'

  if (!result.note) {
    result.note = result.status === 'VERIFIED'
      ? 'Read-only Stripe verification completed. LIVE and TEST subscriptions are separated; no Stripe write was performed.'
      : 'Stripe verification is partial. Unverified values are excluded from LIVE revenue truth.'
  }
  return result
}

function testSignal(email, profile) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const domain = normalizedEmail.includes('@') ? normalizedEmail.split('@').pop() : ''
  const local = normalizedEmail.includes('@') ? normalizedEmail.split('@')[0] : normalizedEmail
  const text = [local, profile?.displayName, profile?.name, profile?.kennelName, profile?.organisationName]
    .filter(Boolean).join(' ').toLowerCase()
  if (TEST_DOMAINS.has(domain)) return 'Known non-production email domain'
  if (TEST_TOKENS.test(text)) return 'Explicit QA/test/demo/staging signal in account metadata'
  return null
}

function classifyAccount({ user, email, dogCount, litterCount, stripeTruth, now }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const internalEntitlement = hasValidInternalEntitlement(user, now)
  if (ALLOWED_ADMINS.includes(normalizedEmail) || internalEntitlement) {
    return { classification: 'INTERNAL', confidence: 'HIGH', reason: internalEntitlement ? 'Valid internal entitlement' : 'Super Admin allowlist' }
  }

  const testReason = testSignal(normalizedEmail, user)
  if (testReason) return { classification: 'TEST_QA', confidence: 'HIGH', reason: testReason }

  if (stripeTruth?.status === 'active' && stripeTruth?.livemode === true) {
    return { classification: 'LIKELY_REAL', confidence: 'HIGH', reason: 'Active LIVE Stripe subscription and no internal/test signal' }
  }
  if (dogCount > 0 || litterCount > 0) {
    return { classification: 'LIKELY_REAL', confidence: 'MEDIUM', reason: 'Meaningful product activity and no internal/test signal' }
  }
  return { classification: 'UNCLASSIFIED', confidence: 'LOW', reason: 'Insufficient evidence to distinguish real user from QA/test/internal use' }
}

async function compileAccountClassification({ users, dogs, activeLitters, revenueTruth, now }) {
  const dogCounts = new Map()
  const litterCounts = new Map()
  dogs.forEach(dog => mapIncrement(dogCounts, dog.tenantId))
  activeLitters.forEach(litter => mapIncrement(litterCounts, litter.tenantId))

  const authEmails = new Map()
  let authStatus = 'VERIFIED'
  try {
    let pageToken
    do {
      const page = await getAuth().listUsers(1000, pageToken)
      page.users.forEach(record => authEmails.set(record.uid, record.email || ''))
      pageToken = page.pageToken
    } while (pageToken)
  } catch {
    authStatus = 'PARTIAL'
  }

  const counts = { internal: 0, testQa: 0, likelyReal: 0, unclassified: 0, likelyRealBreeders: 0, paidLikelyReal: 0, paidInternalOrTest: 0 }
  const accounts = users.map(user => {
    const email = authEmails.get(user.id) || ''
    const dogCount = dogCounts.get(user.id) || 0
    const activeLitterCount = litterCounts.get(user.id) || 0
    const stripeTruth = user.stripeSubscriptionId ? revenueTruth.subscriptionsById[user.stripeSubscriptionId] : null
    const classification = classifyAccount({ user, email, dogCount, litterCount: activeLitterCount, stripeTruth, now })
    const storedPaid = user.subscriptionStatus === 'active' && Boolean(user.stripeSubscriptionId) && user.plan === 'plus'
    const role = user.role || 'unknown'

    if (classification.classification === 'INTERNAL') counts.internal++
    if (classification.classification === 'TEST_QA') counts.testQa++
    if (classification.classification === 'LIKELY_REAL') counts.likelyReal++
    if (classification.classification === 'UNCLASSIFIED') counts.unclassified++
    if (classification.classification === 'LIKELY_REAL' && role === 'breeder') counts.likelyRealBreeders++
    if (storedPaid && classification.classification === 'LIKELY_REAL') counts.paidLikelyReal++
    if (storedPaid && (classification.classification === 'INTERNAL' || classification.classification === 'TEST_QA')) counts.paidInternalOrTest++

    return {
      uid: user.id,
      email: email || null,
      role,
      classification: classification.classification,
      confidence: classification.confidence,
      reason: classification.reason,
      dogCount,
      activeLitterCount,
      storedPaid: Boolean(storedPaid),
      stripeStatus: stripeTruth?.status || null,
      stripeMode: stripeTruth ? (stripeTruth.livemode ? 'LIVE' : 'TEST') : null,
      stripeMrrAud: stripeTruth?.mrrAud ?? null,
    }
  }).sort((a, b) => {
    const order = { INTERNAL: 0, TEST_QA: 1, UNCLASSIFIED: 2, LIKELY_REAL: 3 }
    return (order[a.classification] ?? 9) - (order[b.classification] ?? 9) || String(a.email || a.uid).localeCompare(String(b.email || b.uid))
  })

  return {
    status: authStatus,
    ...counts,
    accounts,
    note: authStatus === 'VERIFIED'
      ? 'Classification uses Super Admin/internal entitlement, explicit QA/test signals, LIVE Stripe evidence and product activity. LIKELY_REAL is a business signal, not identity proof.'
      : 'Firebase Auth email lookup was partial; some accounts remain deliberately UNCLASSIFIED.',
  }
}

function scoredDecision({ id, lane = 'AUTO', title, decision, rationale, owner, kpi, evidence, nextAction, checkpoint, confidence = 'HIGH', impact, urgency, reversibility, cost, financialApprovalRequired = false }) {
  const confidenceWeight = CONFIDENCE_WEIGHT[confidence] || 0.5
  const raw = (impact * urgency * confidenceWeight * reversibility) / Math.max(cost, 1)
  const score = Math.max(0, Math.min(100, Math.round((raw / 125) * 100)))
  const horizon = urgency === 5 || score >= 60 ? 'NOW' : score >= 25 ? 'THIS_WEEK' : score >= 10 ? 'NEXT_BUILD' : 'WATCH'
  return {
    id, lane, title, decision, rationale, owner, kpi, evidence, nextAction, checkpoint,
    confidence, financialApprovalRequired, score, horizon,
    scoring: { impact, urgency, confidenceWeight, reversibility, cost, formula: 'Impact × Urgency × Confidence × Reversibility ÷ Cost' },
  }
}

function localDateParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday }
}

function buildSevenDayPlan({ now, revenueTruth, classification, supportNeedsAction, supportOldestOpenDays, rawBreeders, breedersWithDogs, breedersWithLitters, livePaidBreeders }) {
  const days = [
    {
      focus: 'Revenue truth + account truth', owner: 'AI CEO / Finance + Ops', lane: 'AUTO',
      actions: [
        `Reconcile ${revenueTruth.uniqueStoredSubscriptionIds} stored subscription ID(s) against read-only Stripe truth.`,
        `Review ${classification.unclassified} UNCLASSIFIED and ${classification.testQa} TEST_QA account(s); do not count them as customers until evidence supports it.`,
      ],
      kpi: 'LIVE MRR and customer counts have explicit source truth',
      successCondition: 'No revenue KPI relies on the stale A$5/A$49 Super Admin catalogue.',
    },
    {
      focus: 'Clear support debt', owner: 'AI CEO / Customer', lane: 'AUTO',
      actions: [`Triage ${supportNeedsAction} support conversation(s) requiring action.`, `Prioritise the oldest item (${supportOldestOpenDays} day(s)) and classify root cause.`],
      kpi: 'Action-required support backlog',
      successCondition: 'Backlog is zero or every remaining conversation has a clear owner/status/root cause.',
    },
    {
      focus: 'First-dog activation audit', owner: 'AI CEO / Product', lane: 'AUTO',
      actions: [`Audit signup → dashboard → Add Dog for the ${Math.max(0, rawBreeders - breedersWithDogs)} breeder-shaped account(s) without tenant dogs.`, 'Separate product friction from account-quality/test-data noise before changing onboarding.'],
      kpi: 'Breeder first-dog activation',
      successCondition: 'Top 1–2 reversible activation blockers are identified with evidence.',
    },
    {
      focus: 'Litter + Plus conversion audit', owner: 'AI CEO / Product + Growth', lane: 'AUTO',
      actions: [`Audit why only ${breedersWithLitters}/${Math.max(breedersWithDogs, 1)} dog-active breeder-shaped accounts have active litters.`, `Review Plus upgrade moments against ${livePaidBreeders} verified LIVE paid breeder(s).`],
      kpi: 'Dog→litter progression and LIVE paid breeder share',
      successCondition: 'One smallest conversion experiment is selected for Preview.',
    },
    {
      focus: 'Minimum measurement contract', owner: 'AI CEO / Growth + Product', lane: 'AUTO',
      actions: ['Lock the six-event growth schema and required properties.', 'Do not build a data warehouse; instrument only the unknowns needed for the next decision.'],
      kpi: 'Critical funnel stages have explicit event/source definitions',
      successCondition: 'No ambiguous definition for signup, first value, upgrade, activation or cancellation.',
    },
    {
      focus: 'Preview-only implementation', owner: 'AI CTO / Implementation Agent', lane: 'AUTO',
      actions: ['Prepare minimum instrumentation and highest-leverage reversible UX fix on Preview only.', 'Run build and route QA; production remains blocked.'],
      kpi: 'Preview build + measurement events are testable',
      successCondition: 'Exact SHA passes build/QA without production or financial writes.',
    },
    {
      focus: 'CEO weekly review', owner: 'AI CEO + Tony', lane: 'APPROVAL',
      actions: ['Compare expected vs actual signals from the week.', 'KEEP / MODIFY / KILL / SCALE each experiment and decide whether paid acquisition deserves more budget.'],
      kpi: 'One explicit next-week capital/time allocation decision',
      successCondition: 'Tony receives one ranked decision with evidence, downside and required approval.',
    },
  ]

  return days.map((item, index) => ({
    day: index + 1,
    ...localDateParts(new Date(now.getTime() + index * DAY_MS)),
    ...item,
    checkpoint: index === 6 ? 'Weekly CEO review' : 'End-of-day evidence check',
  }))
}

export async function buildAiCeoV12() {
  const db = getFirestore()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS)

  const [usersSnap, dogsSnap, littersSnap, supportSnap, enquiriesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('dogs').get(),
    db.collection('litters').get(),
    db.collection('supportConversations').limit(100).get(),
    db.collection('showcaseEnquiries').get(),
  ])

  const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  const dogs = dogsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  const litters = littersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  const supportConversations = supportSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  const enquiries = enquiriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  const activeLitters = litters.filter(litter => !litter.archived)

  const revenueTruth = await compileRevenueTruth(users)
  const accountClassification = await compileAccountClassification({ users, dogs, activeLitters, revenueTruth, now })

  const breederIds = new Set(users.filter(user => user.role !== 'owner').map(user => user.id))
  const dogTenantIds = new Set(dogs.map(dog => dog.tenantId).filter(Boolean))
  const litterTenantIds = new Set(activeLitters.map(litter => litter.tenantId).filter(Boolean))
  const breeders = breederIds.size
  const owners = users.filter(user => user.role === 'owner').length
  const breedersWithDogs = [...breederIds].filter(id => dogTenantIds.has(id)).length
  const breedersWithLitters = [...breederIds].filter(id => litterTenantIds.has(id)).length
  const breederDogActivationPct = percentage(breedersWithDogs, breeders)
  const breederLitterActivationPct = percentage(breedersWithLitters, breeders)
  const litterActivationFromDogBreedersPct = percentage(breedersWithLitters, breedersWithDogs)

  let newUsers7d = 0
  let newUsers30d = 0
  let plusEntitledAccounts = 0
  let internalEntitlementAccounts = 0
  let storedActivePaidSubscriptions = 0
  let storedActivePaidBreeders = 0
  users.forEach(user => {
    const createdAt = toDate(user.createdAt)
    if (createdAt >= sevenDaysAgo) newUsers7d++
    if (createdAt >= thirtyDaysAgo) newUsers30d++
    if (computeEffectivePlan(user, now) === 'plus') plusEntitledAccounts++
    if (hasValidInternalEntitlement(user, now)) internalEntitlementAccounts++
    if (user.subscriptionStatus === 'active' && user.stripeSubscriptionId && user.plan === 'plus') {
      storedActivePaidSubscriptions++
      if (user.role !== 'owner') storedActivePaidBreeders++
    }
  })

  const livePaidBreederIds = new Set(accountClassification.accounts
    .filter(account => account.role === 'breeder' && account.stripeStatus === 'active' && account.stripeMode === 'LIVE' && account.classification === 'LIKELY_REAL')
    .map(account => account.uid))

  const supportNeedsActionItems = supportConversations.filter(item => SUPPORT_NEEDS_ACTION.has(item.status))
  const supportUnread = supportConversations.reduce((total, item) => total + Number(item.adminUnreadCount || 0), 0)
  const supportOldestOpenDays = supportNeedsActionItems.reduce((oldest, item) => {
    const age = ageDays(item.lastMessageAt || item.createdAt, now)
    return age === null ? oldest : Math.max(oldest, age)
  }, 0)

  let showcaseEnquiries7d = 0
  let showcaseEnquiries30d = 0
  let showcaseNotificationFailures30d = 0
  enquiries.forEach(item => {
    const createdAt = toDate(item.createdAt)
    if (createdAt >= sevenDaysAgo) showcaseEnquiries7d++
    if (createdAt >= thirtyDaysAgo) {
      showcaseEnquiries30d++
      if (item.notified === false) showcaseNotificationFailures30d++
    }
  })

  let activeDogs = 0
  let transferredDogs = 0
  let restrictedDogs = 0
  let archivedDogs = 0
  const puppyFunnel = { tracked: 0, available: 0, reserved: 0, kept: 0, sold: 0, depositReceived: 0, transferred: 0 }
  dogs.forEach(dog => {
    const status = dog.status || 'active'
    if (status === 'transferred') transferredDogs++
    else if (status === 'restricted') restrictedDogs++
    else if (status === 'archived') archivedDogs++
    else activeDogs++
    if (!dog.litterId && !dog.availabilityStatus) return
    puppyFunnel.tracked++
    if (dog.availabilityStatus === 'available') puppyFunnel.available++
    if (dog.availabilityStatus === 'reserved') puppyFunnel.reserved++
    if (dog.availabilityStatus === 'kept') puppyFunnel.kept++
    if (dog.availabilityStatus === 'sold') puppyFunnel.sold++
    if (dog.depositStatus === 'received') puppyFunnel.depositReceived++
    if (status === 'transferred') puppyFunnel.transferred++
  })

  const decisions = []
  const revenueAmbiguous = revenueTruth.status !== 'VERIFIED' || revenueTruth.legacyDeltaAud !== 0 || accountClassification.paidInternalOrTest > 0 || accountClassification.unclassified > 0
  if (revenueAmbiguous) {
    decisions.push(scoredDecision({
      id: 'establish-revenue-and-customer-truth', title: 'Establish revenue truth and customer truth',
      decision: 'Use LIVE Stripe subscription line items and conservative account classification as the only CEO revenue/customer baseline; keep legacy stored-price estimates diagnostic only.',
      rationale: 'The previous A$10 MRR came from stale A$5/A$49 display math, and raw account counts can include internal, QA or unclassified accounts.',
      owner: 'AI CEO / Finance + Ops', kpi: 'Verified LIVE MRR + classified customer base',
      evidence: [`Stripe truth status: ${revenueTruth.status}`, `LIVE MRR: A$${revenueTruth.verifiedLiveMrrAud}; legacy stored estimate: A$${revenueTruth.legacyStoredEstimateAud}`, `${accountClassification.internal} INTERNAL, ${accountClassification.testQa} TEST_QA, ${accountClassification.unclassified} UNCLASSIFIED account(s)`],
      nextAction: 'Review the Revenue Truth and Account Classification panels; resolve only the ambiguous accounts that materially affect revenue or funnel denominators.',
      checkpoint: 'Revenue and customer KPIs no longer depend on stale price math or knowingly internal/test accounts.',
      confidence: 'HIGH', impact: 5, urgency: 5, reversibility: 5, cost: 1,
    }))
  }

  if (supportNeedsActionItems.length > 0 || supportUnread > 0) {
    decisions.push(scoredDecision({
      id: 'clear-support-friction', title: 'Clear customer support friction before scaling acquisition',
      decision: 'Resolve or classify action-required conversations and feed repeated root causes into the product backlog.',
      rationale: 'Support debt hides product/onboarding failures and compounds when acquisition scales.',
      owner: 'AI CEO / Customer + Product', kpi: 'Action-required backlog and oldest open age',
      evidence: [`${supportNeedsActionItems.length} conversation(s) require action`, `${supportUnread} admin unread`, `Oldest action-required item: ${supportOldestOpenDays} day(s)`],
      nextAction: 'Triage oldest-first, assign root cause, and close or explicitly own every outstanding conversation.',
      checkpoint: 'Backlog reaches zero or every remaining case has a clear owner/status/root cause.',
      confidence: 'HIGH', impact: 4, urgency: supportOldestOpenDays >= 7 ? 5 : 4, reversibility: 5, cost: 1,
    }))
  }

  if (breeders > 0 && breedersWithDogs < breeders) {
    decisions.push(scoredDecision({
      id: 'improve-first-dog-activation', title: 'Increase breeder first-dog activation',
      decision: 'Audit the shortest breeder signup → first useful dog path, but separate true product friction from internal/test/unclassified account noise.',
      rationale: 'Without a dog record a breeder cannot reach the core litter, reports or puppy workflow.',
      owner: 'AI CEO / Product', kpi: 'First-dog activation among customer-quality breeder accounts',
      evidence: [`Raw breeder-shaped activation is ${breedersWithDogs}/${breeders} (${breederDogActivationPct}%)`, `${accountClassification.likelyRealBreeders} breeder account(s) are currently LIKELY_REAL`],
      nextAction: 'Audit the no-dog accounts by classification first, then inspect signup/dashboard/Add Dog friction only for credible customer accounts.',
      checkpoint: 'One or two evidence-backed activation blockers are selected for a reversible Preview experiment.',
      confidence: accountClassification.unclassified > 0 ? 'MEDIUM' : 'HIGH', impact: 5, urgency: 4, reversibility: 5, cost: 2,
    }))
  }

  if (breedersWithDogs > 0 && breedersWithLitters < breedersWithDogs) {
    decisions.push(scoredDecision({
      id: 'improve-first-litter-activation', title: 'Move dog-active breeders into the first-litter workflow',
      decision: 'Reduce friction from dog maintenance into the first litter only after account-quality noise is separated.',
      rationale: 'The litter workflow is a strong recurring-value moment for breeder customers.',
      owner: 'AI CEO / Product', kpi: 'Dog-active breeder → active litter progression',
      evidence: [`${breedersWithLitters}/${breedersWithDogs} dog-active breeder-shaped accounts have active litters (${litterActivationFromDogBreedersPct}%)`],
      nextAction: 'Audit eligible Dam selection, litter CTA visibility, quota messaging and first-litter creation.',
      checkpoint: 'Choose one smallest Preview change tied to a measurable progression event.',
      confidence: 'MEDIUM', impact: 4, urgency: 3, reversibility: 5, cost: 2,
    }))
  }

  decisions.push(scoredDecision({
    id: 'improve-paid-breeder-share', title: 'Increase verified LIVE paid breeder share',
    decision: 'Use verified customer-quality activated accounts to diagnose Plus value communication and upgrade friction before adding material paid acquisition.',
    rationale: 'Conversion efficiency is cheaper to learn from existing product usage than from buying more traffic prematurely.',
    owner: 'AI CEO / Growth + Product', kpi: 'Verified LIVE paid breeder share',
    evidence: [`${livePaidBreederIds.size} LIKELY_REAL breeder account(s) currently have an active LIVE Stripe subscription`, `LIVE verified MRR: A$${revenueTruth.verifiedLiveMrrAud}`],
    nextAction: 'Identify the strongest Plus-only value moment and highest-friction upgrade surface among customer-quality accounts.',
    checkpoint: 'One reversible conversion experiment is ready for Preview with a defined success threshold.',
    confidence: revenueTruth.status === 'VERIFIED' ? 'HIGH' : 'MEDIUM', impact: 5, urgency: 3, reversibility: 5, cost: 2,
  }))

  decisions.push(scoredDecision({
    id: 'minimum-growth-measurement', title: 'Instrument only the minimum growth measurement contract',
    decision: 'Add the six critical business events before building broader analytics: signup_completed, first_dog_created, first_litter_created, upgrade_started, subscription_activated and subscription_cancelled.',
    rationale: 'The CEO needs acquisition source, first-value activation, paid conversion and retention/churn evidence, but iDogs is too early for a large analytics platform.',
    owner: 'AI CEO / Growth + Product', kpi: 'Critical funnel stages have explicit source/event definitions',
    evidence: ['Traffic/acquisition attribution and historical churn remain unknown', 'Current activation metrics are account-state snapshots, not cohorts'],
    nextAction: 'Define event properties and source of truth; implement Preview-only after the higher-urgency customer/revenue work is clear.',
    checkpoint: 'A weekly funnel can be produced without inventing visitor, activation or cancellation history.',
    confidence: 'HIGH', impact: 4, urgency: 3, reversibility: 4, cost: 3,
  }))

  decisions.sort((a, b) => b.score - a.score || b.scoring.urgency - a.scoring.urgency || a.title.localeCompare(b.title))
  decisions.forEach((item, index) => { item.priority = index + 1 })
  const priorityDecision = decisions[0]

  const actionPlan7d = buildSevenDayPlan({
    now, revenueTruth, classification: accountClassification,
    supportNeedsAction: supportNeedsActionItems.length, supportOldestOpenDays,
    rawBreeders: breeders, breedersWithDogs, breedersWithLitters,
    livePaidBreeders: livePaidBreederIds.size,
  })

  return {
    generatedAt: now.toISOString(),
    osVersion: '1.2.0-read-only',
    operatingMode: {
      name: 'READ_ONLY_REALITY_DECISION_KERNEL', autonomousWritesEnabled: false, modelReasoningEnabled: false,
      stripeReadOnlyVerification: true,
      description: 'V1.2 verifies revenue through read-only Stripe calls, classifies account-quality signals conservatively, scores decisions dynamically and produces a 7-day CEO action plan. It performs no Stripe/Firebase/product write.',
    },
    objective: {
      northStar: 'Grow sustainable iDogs enterprise value and recurring free cash flow',
      constraints: ['Customer trust', 'Security', 'Liquidity', 'Legal/compliance', 'Tony approval rights'],
    },
    brief: {
      status: revenueTruth.status === 'VERIFIED' ? 'REALITY_BASELINE_ACTIVE' : 'REALITY_BASELINE_PARTIAL',
      summary: `iDogs has A$${revenueTruth.verifiedLiveMrrAud} verified LIVE MRR, ${accountClassification.likelyReal} LIKELY_REAL account(s), ${accountClassification.unclassified} UNCLASSIFIED account(s), ${supportNeedsActionItems.length} support item(s) requiring action, ${breederDogActivationPct}% raw breeder dog activation and ${breederLitterActivationPct}% raw breeder litter activation. The highest-scored CEO action is ${priorityDecision.title.toLowerCase()} (${priorityDecision.score}/100).`,
      priorityDecisionId: priorityDecision.id,
    },
    revenueTruth,
    accountClassification,
    facts: {
      totalUsers: users.length, breeders, owners, newUsers7d, newUsers30d,
      plusEntitledAccounts, internalEntitlementAccounts,
      storedActivePaidSubscriptions, storedActivePaidBreeders,
      verifiedLivePaidBreeders: livePaidBreederIds.size,
      totalDogs: dogs.length, activeDogs, transferredDogs, restrictedDogs, archivedDogs,
      breedersWithDogs, breederDogActivationPct,
      totalLitters: litters.length, activeLitters: activeLitters.length, breedersWithLitters,
      breederLitterActivationPct, litterActivationFromDogBreedersPct,
      puppyFunnel,
      showcaseEnquiriesTotal: enquiries.length, showcaseEnquiries7d, showcaseEnquiries30d, showcaseNotificationFailures30d,
      supportConversations: supportConversations.length, supportNeedsAction: supportNeedsActionItems.length, supportUnread, supportOldestOpenDays,
    },
    decisions,
    actionPlan7d,
    measurementContract: {
      principle: 'Minimum evidence before analytics complexity',
      events: [
        { event: 'signup_completed', purpose: 'Acquisition denominator', requiredProperties: ['userId', 'role', 'acquisitionSource', 'occurredAt'] },
        { event: 'first_dog_created', purpose: 'First breeder value', requiredProperties: ['userId', 'dogId', 'occurredAt'] },
        { event: 'first_litter_created', purpose: 'Breeder workflow depth', requiredProperties: ['userId', 'litterId', 'occurredAt'] },
        { event: 'upgrade_started', purpose: 'Upgrade intent', requiredProperties: ['userId', 'plan', 'billingInterval', 'surface', 'occurredAt'] },
        { event: 'subscription_activated', purpose: 'Paid conversion', requiredProperties: ['userId', 'subscriptionId', 'priceId', 'livemode', 'occurredAt'] },
        { event: 'subscription_cancelled', purpose: 'Churn', requiredProperties: ['userId', 'subscriptionId', 'reason', 'livemode', 'occurredAt'] },
      ],
    },
    watchItems: [
      { id: 'classification-is-signal', severity: 'TRUTH_GUARD', title: 'LIKELY_REAL is not identity proof', reason: 'Classification is intentionally conservative and must not be used for legal/identity decisions.' },
      { id: 'stripe-read-only', severity: 'TRUTH_GUARD', title: 'Stripe is read-only in v1.2', reason: 'Revenue verification retrieves prices/subscriptions only; no Stripe mutation is implemented.' },
      { id: 'cohort-history', severity: 'DATA_GAP', title: 'Historical retention/churn cohorts are not yet durable', reason: 'The minimum measurement contract must accumulate before cohort claims are valid.' },
      { id: 'puppy-current-state', severity: 'DATA_GAP', title: 'Puppy commercial fields are current state, not sales history', reason: 'Do not infer historical sales conversion from current available/reserved/sold flags.' },
      { id: 'aggregation-scale', severity: 'SCALE_WATCH', title: 'Materialise aggregates when data scale requires it', reason: 'V1.2 keeps read-time scans to avoid migration risk at the current small dataset size.' },
    ],
    approvalPolicy: {
      auto: ['Research', 'Read-only Stripe verification', 'Account-quality analysis', 'KPI reporting', 'Customer/funnel diagnosis', 'Backlog prioritisation', 'Experiment design', 'Preview-safe implementation preparation'],
      approvalRequired: ['Production deployment', 'Material new spend', 'Contracts', 'Legal/tax/payroll decisions', 'Material pricing changes', 'Stripe/Firebase production writes', 'Banking or money movement', 'Destructive production data actions'],
    },
    sourceNotes: {
      revenue: 'LIVE Stripe recurring line items are the v1.2 revenue truth. TEST Stripe is separated. Legacy A$5/A$49 display math is diagnostic only.',
      classification: 'Super Admin/internal entitlement + explicit QA/test signals + LIVE Stripe + product activity; ambiguous accounts remain UNCLASSIFIED.',
      activation: 'Current users/dogs/litters state; raw account-state indicators are not historical cohort rates.',
      support: 'Up to 100 current support conversations, matching the existing Super Admin inbox read limit.',
    },
  }
}
