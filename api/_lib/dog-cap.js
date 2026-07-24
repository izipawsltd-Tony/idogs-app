// api/_lib/dog-cap.js — shared dog-count-cap enforcement for iDogs
// Pricing v1.1 (Pricing_Decision_Record_v1.1.md §3.2/§3.3, LOCKED).
//
// A dog counts toward a plan's cap iff: currentOwnerId === uid,
// status === 'active', isDeceased !== true. Firestore Rules cannot
// express a cross-document count, so — matching this codebase's own
// established pattern for anything Rules can't safely validate (litters,
// heat cycles, puppies all moved to trusted Admin SDK endpoints) — cap
// enforcement lives here, used inside a single db.runTransaction by every
// caller that changes which dogs are active: api/set-dog-status.js,
// api/reconcile-dog-cap.js, and the Stripe webhook's downgrade path
// (api/stripe-webhook.js).
//
// Single where() + client-side filter/sort, per this repo's own
// CLAUDE.md convention (avoid composite-index dependencies — see
// "NEVER use orderBy()").

export const DOG_CAP = Object.freeze({ free: 2, plus: 5 })

export function capForPlan(plan) {
  return plan === 'plus' ? DOG_CAP.plus : DOG_CAP.free
}

function createdAtKey(dog) {
  // createdAt is an ISO string on every dog created via createDog()/
  // create-litter-puppy.js; a legacy doc missing it sorts first (oldest)
  // rather than throwing or being silently excluded — the safest default
  // when we can't tell how old a record actually is.
  return typeof dog.createdAt === 'string' ? dog.createdAt : ''
}

// Returns every dog this uid currently, actively owns — eligible for the
// cap count per §3.2 — sorted oldest-created-first. Must be called with a
// transaction (`tx`) so the read is part of the same atomic operation as
// any write that follows it.
export async function getOwnedActiveDogsSorted(tx, db, uid) {
  const snap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const dogs = snap.docs
    .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter(d => (d.status || 'active') === 'active' && d.isDeceased !== true)
  dogs.sort((a, b) => createdAtKey(a).localeCompare(createdAtKey(b)))
  return dogs
}

// Demotes the newest active dogs beyond `cap` to 'restricted', keeping the
// earliest-created `cap` dogs active — the default §3.3 rule ("If no
// choice is made, the system defaults to the 2 earliest-created dogs").
// A no-op when already within cap. Must run inside `tx`. Returns the ids
// demoted.
export function demoteExcessToRestricted(tx, activeDogsSorted, cap) {
  const excess = activeDogsSorted.slice(cap)
  const nowIso = new Date().toISOString()
  for (const dog of excess) {
    tx.update(dog.ref, { status: 'restricted', updatedAt: nowIso })
  }
  return excess.map(d => d.id)
}

// Convenience wrapper combining the two above — used by the webhook
// downgrade path and the grace-period cron sweep, both of which just want
// "bring this account's active-dog count down to its current plan's cap"
// with no dog-by-dog choice involved.
export async function reconcileDogCapTx(tx, db, uid, plan) {
  const cap = capForPlan(plan)
  const active = await getOwnedActiveDogsSorted(tx, db, uid)
  if (active.length <= cap) return { demoted: [], cap, activeCount: active.length }
  const demoted = demoteExcessToRestricted(tx, active, cap)
  return { demoted, cap, activeCount: cap }
}

// Reactivates restricted dogs, earliest-created first, up to `cap` — the
// §3.3 upgrade rule ("On upgrade back to Plus, all restricted dogs return
// to active automatically, up to the new cap of 5. If more than 5 exist,
// the earliest-created 5 become active and the user is prompted to
// choose."). Never touches archived dogs (a deliberate user action,
// distinct from a system-imposed restriction). Must run inside `tx`.
export async function reactivateUpToCapTx(tx, db, uid, plan) {
  const cap = capForPlan(plan)
  const activeSnap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const all = activeSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
  const currentlyActive = all.filter(d => (d.status || 'active') === 'active' && d.isDeceased !== true)
  const restricted = all.filter(d => d.status === 'restricted' && d.isDeceased !== true)
  restricted.sort((a, b) => createdAtKey(a).localeCompare(createdAtKey(b)))

  const room = Math.max(0, cap - currentlyActive.length)
  const toReactivate = restricted.slice(0, room)
  const nowIso = new Date().toISOString()
  for (const dog of toReactivate) {
    tx.update(dog.ref, { status: 'active', updatedAt: nowIso })
  }
  const remainingRestricted = restricted.length - toReactivate.length
  return { reactivated: toReactivate.map(d => d.id), remainingRestricted }
}
