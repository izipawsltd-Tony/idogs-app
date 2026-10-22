// Read-only, offline reconciliation. Inputs are explicitly normalized operator exports.
// Never fetch private data, create contacts, infer consent, or send messages.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { audienceDryRun } from './lib/promotion-emails.js'

const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 256
const normalizedEmail = x => typeof x === 'string' ? x.trim().toLowerCase() : ''
const positive = x => x === true
const finiteDate = x => typeof x === 'string' && Number.isFinite(Date.parse(x))
const collection = (o, key) => {
  if (!Array.isArray(o[key])) throw new Error(`Missing required array: ${key}`)
  return o[key]
}
const indexUnique = (rows, key, source) => {
  const map = new Map()
  const duplicate = new Set()
  for (const row of rows) {
    const id = key(row)
    if (!validId(id)) throw new Error(`Invalid ${source} join key`)
    if (map.has(id)) duplicate.add(id)
    else map.set(id, row)
  }
  for (const id of duplicate) map.set(id, null) // fail closed for conflicting records
  return map
}
const fresh = (value, now, maxAgeMs) =>
  finiteDate(value) && Date.parse(value) <= now && now - Date.parse(value) <= maxAgeMs

/**
 * Private input contract: { capturedAt, auth, profiles, billing, suppression, consent }.
 * Every record keyed by uid except suppression keyed by email. Billing must include
 * currentSubscription:false based on current Stripe truth, not a cached profile plan.
 * Consent requires affirmative action evidence plus policy version and opt-in timestamp.
 * No raw customer data is returned, logged or written.
 */
export function reconcileRecipientInventory(snapshot, now = Date.now()) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Missing inventory snapshot')
  for (const key of ['auth','profiles','billing','suppression','consent']) collection(snapshot,key)
  if (!fresh(snapshot.capturedAt, now, 5 * 60_000))
    throw new Error('Inventory stale or timestamp invalid')
  const auth = snapshot.auth
  const profiles = indexUnique(snapshot.profiles, r => r?.uid, 'profiles')
  const billing = indexUnique(snapshot.billing, r => r?.uid, 'billing')
  const consents = indexUnique(snapshot.consent, r => r?.uid, 'consent')
  const suppressions = indexUnique(snapshot.suppression, r => normalizedEmail(r?.email), 'suppression')
  const seenAuth = new Set()
  const entries = []
  for (const user of auth) {
    const uid = user?.uid
    if (!validId(uid)) throw new Error('Invalid auth uid')
    const duplicateUid = seenAuth.has(uid)
    seenAuth.add(uid)
    const profile = profiles.get(uid)
    const subscription = billing.get(uid)
    const consent = consents.get(uid)
    const suppression = suppressions.get(normalizedEmail(user.email))
    const permission = !duplicateUid && consent &&
      consent.choice === 'opt_in' && consent.channel === 'email_marketing' &&
      consent.source === 'explicit_checkbox' && consent.checkboxDefault === false &&
      validId(consent.policyVersion) && validId(consent.evidenceRef) &&
      finiteDate(consent.optedInAt) && Date.parse(consent.optedInAt) <= now &&
      consent.revokedAt == null && normalizedEmail(consent.email) === normalizedEmail(user.email)
    // If suppression or provider export is incomplete, hold rather than assume false.
    const suppressionKnown = suppression && suppression.status === 'clear' &&
      fresh(suppression.checkedAt, now, 5 * 60_000)
    entries.push({
      email: user.email,
      emailVerified: !duplicateUid && user.emailVerified === true,
      checkedAt: snapshot.capturedAt,
      accountActive: !duplicateUid && user.disabled === false && profile?.accountActive === true,
      deletionPending: profile?.deletionPending,
      effectivePlan: subscription?.effectivePlan,
      currentSubscription: subscription?.currentSubscription,
      promotionPendingOrJoined: subscription?.promotionPendingOrJoined,
      qaOrInternal: profile?.qaOrInternal,
      marketingPermission: consent?.choice === 'opt_out' || consent?.revokedAt != null ? 'denied' : permission ? 'verified' : 'unknown',
      permissionEvidence: permission ? consent.evidenceRef : '',
      suppressed: suppression?.status === 'suppressed' ? true : suppressionKnown ? false : undefined,
    })
  }
  const result = audienceDryRun(entries, now)
  return { ...result, sources: { auth: auth.length, profiles: snapshot.profiles.length,
    billing: snapshot.billing.length, consent: snapshot.consent.length, suppression: snapshot.suppression.length },
    verifiedAgainst: snapshot.capturedAt }
}

export const MARKETING_CONSENT_CONTRACT = Object.freeze({
  checkboxDefault: false,
  label: 'Email me iDogs product news and promotional offers (optional).',
  separateFromTerms: true,
  permittedActions: ['opt_in','opt_out'],
  requiredEvidence: ['uid','email','channel','choice','source','checkboxDefault','policyVersion','evidenceRef','optedInAt'],
  revokeAnyTime: true,
  note: 'This is a proposed consent capture contract. No production capture or schema change is installed.'
})

if (process.argv[1]?.endsWith('/recipient-inventory-preflight.mjs') || process.argv[1]?.endsWith('\\recipient-inventory-preflight.mjs')) {
  const file = process.argv[2]
  if (!file || process.argv.length !== 3) {
    console.error('Usage: node scripts/recipient-inventory-preflight.mjs /private/normalized-snapshot.json')
    process.exitCode = 2
  } else {
    try {
      const snapshot = JSON.parse(await readFile(resolve(file), 'utf8'))
      console.log(JSON.stringify(reconcileRecipientInventory(snapshot), null, 2))
    } catch (error) {
      console.error('Inventory preflight failed:', error.message)
      process.exitCode = 1
    }
  }
}
