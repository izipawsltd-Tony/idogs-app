// api/super-admin/ai-ceo.js — AI CEO OS v1.1 read-only decision kernel
//
// This endpoint is intentionally deterministic and read-only. It converts
// trusted iDogs operating data into a concise CEO brief, measurable funnel
// signals, explicit decisions, and approval lanes. It introduces no model
// provider, no new secret, no external write, no Stripe mutation, and no
// Firebase Rules/environment change.
import { getFirestore } from 'firebase-admin/firestore'
import { computeEffectivePlan, hasValidInternalEntitlement } from '../_lib/entitlements.js'
import { getEstimatedMonthlyPrice } from './_pricing.js'
import { verifySuperAdmin } from './_auth.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SUPPORT_NEEDS_ACTION = new Set(['new', 'open', 'waiting_for_support'])

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

function ageDays(value, now) {
  const date = toDate(value)
  if (date.getTime() <= 0) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS))
}

function decision({ id, lane = 'AUTO', priority, title, decision, rationale, owner, kpi, evidence, nextAction, checkpoint, confidence = 'HIGH', reversible = true, financialApprovalRequired = false }) {
  return {
    id,
    lane,
    priority,
    title,
    decision,
    rationale,
    owner,
    kpi,
    evidence,
    nextAction,
    checkpoint,
    confidence,
    reversible,
    financialApprovalRequired,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return

  try {
    const db = getFirestore()
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS)

    // Core operating reads intentionally fail closed as one unit. A partial
    // business picture is worse than an unavailable brief because it can cause
    // the CEO layer to make a confidently wrong priority decision.
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

    let breeders = 0
    let owners = 0
    let activePaidSubscriptions = 0
    let activePaidBreeders = 0
    let plusEntitledAccounts = 0
    let internalEntitlementAccounts = 0
    let freeAccounts = 0
    let mrr = 0
    let newUsers7d = 0
    let newUsers30d = 0

    const breederIds = new Set()

    users.forEach(user => {
      const isOwner = user.role === 'owner'
      if (isOwner) owners++
      else {
        breeders++
        breederIds.add(user.id)
      }

      const effectivePlan = computeEffectivePlan(user, now)
      if (effectivePlan === 'plus') plusEntitledAccounts++
      else freeAccounts++

      if (hasValidInternalEntitlement(user, now)) internalEntitlementAccounts++

      const hasActivePaidSubscription =
        user.subscriptionStatus === 'active' &&
        Boolean(user.stripeSubscriptionId) &&
        user.plan === 'plus'

      if (hasActivePaidSubscription) {
        activePaidSubscriptions++
        if (!isOwner) activePaidBreeders++
        mrr += getEstimatedMonthlyPrice(user)
      }

      const createdAt = toDate(user.createdAt)
      if (createdAt >= sevenDaysAgo) newUsers7d++
      if (createdAt >= thirtyDaysAgo) newUsers30d++
    })

    const dogTenantIds = new Set()
    let activeDogs = 0
    let transferredDogs = 0
    let restrictedDogs = 0
    let archivedDogs = 0

    const puppyFunnel = {
      tracked: 0,
      available: 0,
      reserved: 0,
      kept: 0,
      sold: 0,
      depositReceived: 0,
      transferred: 0,
    }

    dogs.forEach(dog => {
      if (dog.tenantId) dogTenantIds.add(dog.tenantId)

      const status = dog.status || 'active'
      if (status === 'transferred') transferredDogs++
      else if (status === 'restricted') restrictedDogs++
      else if (status === 'archived') archivedDogs++
      else activeDogs++

      const isTrackedPuppy = Boolean(dog.litterId || dog.availabilityStatus)
      if (!isTrackedPuppy) return

      puppyFunnel.tracked++
      if (dog.availabilityStatus === 'available') puppyFunnel.available++
      if (dog.availabilityStatus === 'reserved') puppyFunnel.reserved++
      if (dog.availabilityStatus === 'kept') puppyFunnel.kept++
      if (dog.availabilityStatus === 'sold') puppyFunnel.sold++
      if (dog.depositStatus === 'received') puppyFunnel.depositReceived++
      if (status === 'transferred') puppyFunnel.transferred++
    })

    const breedersWithDogs = [...breederIds].filter(id => dogTenantIds.has(id)).length

    const activeLitters = litters.filter(litter => !litter.archived)
    const litterTenantIds = new Set(activeLitters.map(litter => litter.tenantId).filter(Boolean))
    const breedersWithLitters = [...breederIds].filter(id => litterTenantIds.has(id)).length

    const supportNeedsAction = supportConversations.filter(item => SUPPORT_NEEDS_ACTION.has(item.status))
    const supportUnread = supportConversations.reduce((total, item) => total + Number(item.adminUnreadCount || 0), 0)
    const supportOldestOpenDays = supportNeedsAction.reduce((oldest, item) => {
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

    const paidAccountShare = percentage(activePaidSubscriptions, users.length)
    const paidBreederShare = percentage(activePaidBreeders, breeders)
    const breederDogActivation = percentage(breedersWithDogs, breeders)
    const breederLitterActivation = percentage(breedersWithLitters, breeders)
    const litterActivationFromDogBreeders = percentage(breedersWithLitters, breedersWithDogs)
    const internalGrantShareOfPlus = percentage(internalEntitlementAccounts, plusEntitledAccounts)

    const decisions = []

    // Measurement remains priority #1 because acquisition and retention are
    // still outside this trusted dataset. The new operational funnel narrows
    // the unknowns without pretending that account shares are conversion rates.
    decisions.push(decision({
      id: 'complete-growth-measurement',
      priority: 1,
      title: 'Complete the acquisition and retention measurement layer',
      decision: 'Keep acquisition source, visitor-to-signup, activation events, cohort retention, churn and experiment outcomes as the next measurement build before materially scaling paid marketing.',
      rationale: 'The CEO OS can now see product activation, breeder workflow depth, puppy demand signals and support friction, but it still cannot calculate CAC, true signup conversion or churn.',
      owner: 'AI CEO / Growth + Product',
      kpi: 'Weekly funnel has acquisition, activation, paid conversion, retention and expansion with explicit source-of-truth fields',
      evidence: [
        `${users.length} registered accounts; ${newUsers7d} new in 7d and ${newUsers30d} new in 30d`,
        `${breederDogActivation}% of breeder accounts currently have at least one tenant dog`,
        `${breederLitterActivation}% of breeder accounts currently have an active litter`,
      ],
      nextAction: 'Define the minimum event schema for acquisition source, first-value activation, upgrade, cancellation and retention checkpoints.',
      checkpoint: 'Review after the first complete weekly funnel can be generated without an UNKNOWN critical stage.',
    }))

    if (breeders > 0 && breedersWithDogs < breeders) {
      decisions.push(decision({
        id: 'improve-first-dog-activation',
        priority: 2,
        title: 'Increase breeder first-dog activation',
        decision: 'Prioritise the shortest onboarding path from breeder signup to the first useful dog record before adding more acquisition complexity.',
        rationale: 'A breeder account without a dog cannot reach the core breeding, litter, report or puppy-sale workflows.',
        owner: 'AI CEO / Product',
        kpi: 'Breeder accounts with at least one dog / registered breeder accounts',
        evidence: [`${breedersWithDogs}/${breeders} breeders have at least one tenant dog (${breederDogActivation}%)`],
        nextAction: 'Audit signup → dashboard → Add Dog friction and prepare the smallest reversible onboarding improvement for Preview.',
        checkpoint: 'Compare first-dog activation after the next cohort of breeder signups.',
      }))
    } else if (breedersWithDogs > 0 && breedersWithLitters < breedersWithDogs) {
      decisions.push(decision({
        id: 'improve-first-litter-activation',
        priority: 2,
        title: 'Move activated breeders into the first-litter workflow',
        decision: 'Reduce friction between maintaining dog records and creating/managing the first litter.',
        rationale: 'Dog activation exists, but fewer breeder accounts progress into the workflow most closely tied to breeder recurring value.',
        owner: 'AI CEO / Product',
        kpi: 'Breeders with active litters / breeders with dogs',
        evidence: [`${breedersWithLitters}/${breedersWithDogs} dog-active breeders have an active litter (${litterActivationFromDogBreeders}%)`],
        nextAction: 'Audit eligible Dam selection, litter CTA visibility, quota messaging and first-litter creation steps.',
        checkpoint: 'Measure first-litter activation on the next breeder cohort.',
      }))
    }

    if (activePaidSubscriptions === 0 && users.length > 0) {
      decisions.push(decision({
        id: 'monetise-activated-users',
        priority: 3,
        title: 'Create recurring revenue from existing activation before increasing paid acquisition',
        decision: 'Use existing activated accounts to diagnose Plus value communication and upgrade friction before committing material marketing spend.',
        rationale: 'Registered and activated product usage provides a lower-cost learning pool than buying more traffic before the paid path is proven.',
        owner: 'AI CEO / Growth + Product',
        kpi: 'First stored active paid subscriptions and paid breeder share',
        evidence: [
          `${activePaidSubscriptions} stored active paid subscriptions`,
          `${breedersWithDogs} breeder accounts already have dog records`,
          `${breedersWithLitters} breeder accounts already have active litters`,
        ],
        nextAction: 'Review Plus upgrade moments against the highest-value breeder workflows and prepare one reversible conversion experiment.',
        checkpoint: 'Evaluate once the experiment has enough activated-account exposure to make a directional decision.',
      }))
    } else if (activePaidSubscriptions > 0) {
      decisions.push(decision({
        id: 'improve-paid-breeder-share',
        priority: 3,
        title: 'Increase paid share without adding fixed cost',
        decision: 'Improve onboarding, Plus value communication and upgrade friction using current product traffic before adding material fixed operating cost.',
        rationale: 'Paid adoption exists, so the next low-risk step is improving conversion efficiency inside the current product.',
        owner: 'AI CEO / Growth + Product',
        kpi: 'Paid breeder share with stable support burden',
        evidence: [
          `${activePaidBreeders}/${breeders} breeder accounts have stored active paid subscriptions (${paidBreederShare}%)`,
          `Estimated stored-field MRR is A$${mrr}; this is not live Stripe ledger truth`,
        ],
        nextAction: 'Identify the highest-traffic upgrade surfaces and the strongest Plus-only value moment.',
        checkpoint: 'Review paid breeder share weekly after the next conversion change.',
      }))
    }

    const activeMarketPuppies = puppyFunnel.available + puppyFunnel.reserved
    const completedPuppyOutcomes = Math.max(puppyFunnel.sold, puppyFunnel.transferred)

    if (activeMarketPuppies > 0 && showcaseEnquiries30d === 0) {
      decisions.push(decision({
        id: 'increase-puppy-demand',
        priority: 4,
        title: 'Generate demand for currently marketed puppies',
        decision: 'Improve Showcase distribution and enquiry conversion before adding a new puppy-sales feature.',
        rationale: 'The product already contains puppies in active commercial stages but no Showcase enquiry signal was recorded in the last 30 days.',
        owner: 'AI CEO / Growth',
        kpi: 'Qualified Showcase enquiries per available/reserved puppy',
        evidence: [
          `${puppyFunnel.available} available and ${puppyFunnel.reserved} reserved tracked puppies`,
          `${showcaseEnquiries30d} Showcase enquiries in 30d`,
        ],
        nextAction: 'Audit whether live Showcase links are being created, shared and reached; then prepare the lowest-cost distribution experiment.',
        checkpoint: 'Review after 30 days or the first 10 qualified Showcase visits/enquiries, whichever creates a usable signal first.',
        confidence: 'MEDIUM',
      }))
    } else if (showcaseEnquiries30d > 0 && completedPuppyOutcomes === 0 && puppyFunnel.tracked > 0) {
      decisions.push(decision({
        id: 'improve-enquiry-to-sale',
        priority: 4,
        title: 'Improve enquiry-to-sale follow-up',
        decision: 'Focus on response speed and breeder follow-up workflow before spending to generate more enquiries.',
        rationale: 'Demand is entering the Showcase funnel but no tracked sold/transferred puppy outcome is visible in the current commercial state.',
        owner: 'AI CEO / Customer + Growth',
        kpi: 'Enquiry-to-reservation and enquiry-to-sold progression',
        evidence: [`${showcaseEnquiries30d} Showcase enquiries in 30d`, `${puppyFunnel.sold} sold and ${puppyFunnel.transferred} transferred tracked puppies`],
        nextAction: 'Review enquiry response workflow, reservation capture and deposit-state usage.',
        checkpoint: 'Review when the next enquiry cohort reaches reservation/sale outcome.',
        confidence: 'MEDIUM',
      }))
    }

    if (supportNeedsAction.length > 0 || supportUnread > 0) {
      decisions.push(decision({
        id: 'clear-support-friction',
        priority: 5,
        title: 'Clear customer support friction before scaling acquisition',
        decision: 'Resolve or classify conversations requiring support action and feed repeated issues into the product backlog.',
        rationale: 'Unresolved support demand can hide onboarding, billing or product defects and becomes more expensive when acquisition scales.',
        owner: 'AI CEO / Customer + Product',
        kpi: 'Support conversations requiring action, unread messages, and oldest open age',
        evidence: [
          `${supportNeedsAction.length} conversations require support action`,
          `${supportUnread} admin-unread messages`,
          `Oldest action-required conversation is ${supportOldestOpenDays} day(s) old`,
        ],
        nextAction: 'Triage action-required conversations by root cause and identify any repeated product blocker.',
        checkpoint: 'Recheck when action-required backlog returns to zero or all remaining items have an explicit owner/status.',
      }))
    }

    decisions.push(decision({
      id: 'protect-production-gate',
      lane: 'APPROVAL',
      priority: 99,
      title: 'Keep irreversible and production-risk actions behind Tony approval',
      decision: 'AI may research, diagnose, prioritise, draft and prepare Preview-safe changes; production deployment, material spend, pricing, contracts, money movement and sensitive platform changes remain blocked pending explicit approval.',
      rationale: 'This preserves the existing iDogs release discipline while allowing high automation on reversible work.',
      owner: 'Tony / Financial Approval Gate',
      kpi: 'Zero unapproved production or financial-risk actions',
      evidence: ['AI CEO OS v1.1 has autonomousWritesEnabled=false', 'Current endpoint performs GET-only operating reads'],
      nextAction: 'No action unless a proposed decision crosses an approval boundary.',
      checkpoint: 'Every material decision and every production release.',
      reversible: false,
      financialApprovalRequired: true,
    }))

    const watchItems = [
      {
        id: 'churn-history',
        severity: 'DATA_GAP',
        title: 'Churn and cohort retention are not yet measurable',
        reason: 'Historical cancellation/cohort outcomes are not yet available as a durable CEO measurement series.',
      },
      {
        id: 'stripe-live-truth',
        severity: 'DATA_GAP',
        title: 'MRR is estimated from stored subscription fields',
        reason: 'This endpoint deliberately does not query live Stripe, so estimated MRR must not be treated as an accounting ledger.',
      },
      {
        id: 'funnel-traffic',
        severity: 'DATA_GAP',
        title: 'Traffic and acquisition attribution are outside the current trusted dataset',
        reason: 'True visitor → signup conversion and CAC require an approved analytics/marketing source.',
      },
      {
        id: 'state-not-history',
        severity: 'DATA_GAP',
        title: 'Puppy commercial fields describe current state, not full sales history',
        reason: 'Available/reserved/sold/deposit indicators are useful operational signals but cannot reconstruct historical conversion cohorts by themselves.',
      },
      {
        id: 'aggregation-scale',
        severity: 'SCALE_WATCH',
        title: 'Read-time aggregation should be materialised when dataset size justifies it',
        reason: 'V1.1 scans trusted operating collections to stay migration-free. At larger scale, snapshots/event aggregates should replace full collection scans.',
      },
    ]

    const priorityDecision = [...decisions].sort((a, b) => a.priority - b.priority)[0]

    const payload = {
      generatedAt: now.toISOString(),
      osVersion: '1.1.0-read-only',
      operatingMode: {
        name: 'READ_ONLY_DECISION_KERNEL',
        autonomousWritesEnabled: false,
        modelReasoningEnabled: false,
        description: 'V1.1 reads trusted iDogs operating collections, measures product/revenue/support signals and produces deterministic decisions. It performs no external writes or model-provider calls.',
      },
      objective: {
        northStar: 'Grow sustainable iDogs enterprise value and recurring free cash flow',
        constraints: ['Customer trust', 'Security', 'Liquidity', 'Legal/compliance', 'Tony approval rights'],
      },
      decisionFramework: [
        'FRAME — define the real problem, objective, constraints and success metric',
        'EVIDENCE — separate FACT / ASSUMPTION / UNKNOWN using trusted product data',
        'OPTIONS — compare conservative, balanced, aggressive and do-nothing paths where relevant',
        'ASYMMETRIC EVALUATION — weigh upside, downside, cost, speed, reversibility and opportunity cost',
        'DECIDE — recommend one path and assign AUTO or TONY APPROVAL',
        'EXECUTE / MEASURE / LEARN — owner, action, KPI, checkpoint, then keep/modify/kill/scale',
      ],
      facts: {
        totalUsers: users.length,
        breeders,
        owners,
        newUsers7d,
        newUsers30d,
        activePaidSubscriptions,
        activePaidBreeders,
        estimatedMrrAud: mrr,
        plusEntitledAccounts,
        internalEntitlementAccounts,
        freeAccounts,
        paidAccountSharePct: paidAccountShare,
        paidBreederSharePct: paidBreederShare,
        internalGrantShareOfPlusPct: internalGrantShareOfPlus,
        totalDogs: dogs.length,
        activeDogs,
        transferredDogs,
        restrictedDogs,
        archivedDogs,
        breedersWithDogs,
        breederDogActivationPct: breederDogActivation,
        totalLitters: litters.length,
        activeLitters: activeLitters.length,
        breedersWithLitters,
        breederLitterActivationPct: breederLitterActivation,
        litterActivationFromDogBreedersPct: litterActivationFromDogBreeders,
        puppyFunnel,
        showcaseEnquiriesTotal: enquiries.length,
        showcaseEnquiries7d,
        showcaseEnquiries30d,
        showcaseNotificationFailures30d,
        supportConversations: supportConversations.length,
        supportNeedsAction: supportNeedsAction.length,
        supportUnread,
        supportOldestOpenDays,
      },
      brief: {
        status: activePaidSubscriptions > 0 ? 'OPERATING_AND_OPTIMISING' : 'BUILDING_RECURRING_REVENUE',
        summary: activePaidSubscriptions > 0
          ? `iDogs has ${activePaidSubscriptions} stored active paid subscription${activePaidSubscriptions === 1 ? '' : 's'}, estimated MRR of A$${mrr}, ${breederDogActivation}% breeder dog activation and ${breederLitterActivation}% breeder litter activation. The CEO priority is ${priorityDecision.title.toLowerCase()}.`
          : `iDogs has ${users.length} registered account${users.length === 1 ? '' : 's'}, ${breedersWithDogs} breeder account${breedersWithDogs === 1 ? '' : 's'} with dogs and ${breedersWithLitters} with active litters, but no stored active paid subscription. The CEO priority is ${priorityDecision.title.toLowerCase()}.`,
        priorityDecisionId: priorityDecision.id,
      },
      decisions: decisions.sort((a, b) => a.priority - b.priority),
      watchItems,
      approvalPolicy: {
        auto: ['Research', 'Analysis', 'KPI reporting', 'Customer/funnel diagnosis', 'Draft marketing', 'Backlog prioritisation', 'Experiment design', 'Preview-safe implementation preparation'],
        approvalRequired: ['Production deployment', 'Material new spend', 'Contracts', 'Legal/tax/payroll decisions', 'Material pricing changes', 'Stripe/Firebase production changes', 'Banking or money movement', 'Destructive production data actions'],
      },
      sourceNotes: {
        revenue: 'Stored subscription fields and estimated plan pricing; not live Stripe ledger truth.',
        activation: 'Current users/dogs/litters state; account-share indicators are not historical cohort conversion rates.',
        puppyFunnel: 'Current Dog commercial/ownership fields; not a historical sales ledger.',
        support: 'Up to 100 current support conversations, matching the existing Super Admin inbox read limit.',
      },
    }

    return res.status(200).json(payload)
  } catch (error) {
    console.error('AI CEO OS aggregation error:', error)
    return res.status(500).json({ error: 'Failed to compile AI CEO operating brief', message: error.message })
  }
}
