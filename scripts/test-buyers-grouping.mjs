// Breeder Workspace completion batch — regression test for
// src/pages/BuyersPage.tsx's buyer identity resolution and grouping
// logic (M7_DATA_MODEL.md §5, "Buyers V1 — Option C derived view").
//
// BuyersPage.tsx is a .tsx React component with react-router-dom/
// firebase-touching imports (via ../lib/db), so — like db.ts elsewhere
// in this project's test suite — it can't be bundled and imported
// directly without either a DOM or triggering Firebase initialization.
// This mirrors resolveIdentity()/buildBuyers() exactly (verified by
// inspection, both tiny and reviewed together in the same commit as
// this test) rather than re-implementing different logic.
//
// Usage: node scripts/test-buyers-grouping.mjs

function normEmail(v) { return (v || '').trim().toLowerCase() }
function normPhone(v) { return (v || '').replace(/\D/g, '') }
function toTime(v) {
  if (!v) return 0
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

// Exact mirror of resolveIdentity() as fixed in this batch: transferred
// dogs use buyer* fields ONLY, reserved dogs use reservedFor* fields
// ONLY — no cross-fallback between the two (M7_DATA_MODEL.md §1's
// locked rule: "Reservation writes reservedFor* ONLY. Sale/transfer
// writes buyer* ONLY... this keeps prospective buyer and completed
// buyer cleanly separable").
function resolveIdentity(dog) {
  const transferred = !!dog.transferredAt
  const relationship = transferred ? 'transferred' : 'reserved'

  const email = transferred ? normEmail(dog.buyerEmail) : normEmail(dog.reservedForEmail)
  const phone = transferred ? normPhone(dog.buyerPhone) : normPhone(dog.reservedForPhone)
  const name = (transferred ? dog.buyerName : dog.reservedForName) || ''

  const key = email || phone
  if (!key) return null

  return { key, email, phone, name: name.trim(), relationship }
}

function buildBuyers(dogs) {
  const map = new Map()
  for (const dog of dogs) {
    const id = resolveIdentity(dog)
    if (!id) continue
    const activity = id.relationship === 'transferred' ? toTime(dog.transferredAt) : toTime(dog.reservedAt)
    let buyer = map.get(id.key)
    if (!buyer) {
      buyer = { key: id.key, name: id.name, email: id.email, phone: id.phone, dogs: [], reservedCount: 0, transferredCount: 0, lastActivity: 0 }
      map.set(id.key, buyer)
    }
    if (!buyer.name && id.name) buyer.name = id.name
    if (!buyer.email && id.email) buyer.email = id.email
    if (!buyer.phone && id.phone) buyer.phone = id.phone
    buyer.dogs.push({ dog, relationship: id.relationship, activity })
    if (id.relationship === 'transferred') buyer.transferredCount += 1
    else buyer.reservedCount += 1
    if (activity > buyer.lastActivity) buyer.lastActivity = activity
  }
  const buyers = Array.from(map.values())
  for (const b of buyers) b.dogs.sort((a, c) => c.activity - a.activity)
  buyers.sort((a, b) => {
    if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity
    const an = a.name || a.email || a.phone
    const bn = b.name || b.email || b.phone
    return an.localeCompare(bn)
  })
  return buyers
}

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

function dog(overrides = {}) {
  return { id: 'd1', name: 'Puppy', ...overrides }
}

// ── Email normalisation (trim + lowercase, per §5's grouping key rule) ──
{
  const d1 = dog({ id: 'a', reservedForEmail: '  Sarah@Email.com  ', reservedForName: 'Sarah' })
  const d2 = dog({ id: 'b', reservedForEmail: 'sarah@email.com', reservedForName: 'Sarah' })
  const buyers = buildBuyers([d1, d2])
  check('Emails normalised (trim+lowercase) so the same buyer groups across casing/whitespace variants', buyers.length === 1 && buyers[0].dogs.length === 2)
}

// ── Union of reservedForEmail + buyerEmail sources (§5: "Buyer set = UNION") ──
{
  const reserved = dog({ id: 'r1', reservedForEmail: 'buyer@example.com', reservedForName: 'Buyer', reservedAt: '2026-01-01' })
  const transferred = dog({ id: 't1', transferredAt: '2026-02-01', buyerEmail: 'other@example.com', buyerName: 'Other' })
  const buyers = buildBuyers([reserved, transferred])
  check('Both a reserved-only dog and a transferred-only dog each produce a buyer', buyers.length === 2)
}

// ── Same person: reserved one puppy, later transferred a different one ──
{
  const reservedDog = dog({ id: 'p1', name: 'Puppy A', reservedForEmail: 'sarah@email.com', reservedForName: 'Sarah Wilson', reservedAt: '2026-01-01' })
  const transferredDog = dog({ id: 'p2', name: 'Puppy B', transferredAt: '2026-02-01', buyerEmail: 'sarah@email.com', buyerName: 'Sarah Wilson' })
  const buyers = buildBuyers([reservedDog, transferredDog])
  check('Same email across reserved + transferred dogs groups into one buyer with both relationships', buyers.length === 1 && buyers[0].reservedCount === 1 && buyers[0].transferredCount === 1)
}

// ── THE FIXED BUG: reserved by one person, transferred to a different person, buyerEmail present ──
{
  // Puppy was reserved by Alice, then actually sold/transferred to Bob.
  // buyerEmail is correctly populated with Bob's email (the real,
  // completed sale) — the resolved identity must be Bob, never Alice.
  const d = dog({
    id: 'p3', transferredAt: '2026-03-01',
    buyerEmail: 'bob@example.com', buyerName: 'Bob Buyer',
    reservedForEmail: 'alice@example.com', reservedForName: 'Alice Reserver', reservedAt: '2026-01-01',
  })
  const buyers = buildBuyers([d])
  check('Transferred dog with both buyer* and stale reservedFor* resolves to the ACTUAL buyer (Bob), not the original reserver (Alice)',
    buyers.length === 1 && buyers[0].email === 'bob@example.com' && buyers[0].name === 'Bob Buyer')
  check('Alice never appears as a separate or merged buyer for this dog', !buyers.some(b => b.email === 'alice@example.com'))
}

// ── THE FIXED BUG, inverse: reserved dog with no reservedFor* but a stale/irrelevant buyerEmail ──
{
  // A dog that is still only reserved (not transferred) must never be
  // attributed to buyerEmail, even if that field happens to be
  // non-empty (e.g. leftover from a prior, unrelated transfer that was
  // later reset) — the locked rule is field-set-per-relationship, not
  // "whichever field happens to be filled in".
  const d = dog({ id: 'p4', reservedForEmail: '', reservedForName: '', reservedAt: '2026-01-01', buyerEmail: 'irrelevant@example.com', buyerName: 'Irrelevant' })
  const buyers = buildBuyers([d])
  check('A reserved (not transferred) dog with empty reservedFor* is NOT attributed to buyerEmail — falls through as ungroupable', buyers.length === 0)
}

// ── No email, falls back to phone (§5: "fall back to normalized phone") ──
{
  const d = dog({ id: 'p5', transferredAt: '2026-01-01', buyerPhone: '0412 345 678', buyerName: 'Phone Only Buyer' })
  const buyers = buildBuyers([d])
  check('No email but a phone present groups by normalised phone', buyers.length === 1 && buyers[0].phone === '0412345678')
}

// ── Neither email nor phone: ungroupable, dog listed individually (§5) ──
{
  const d = dog({ id: 'p6', transferredAt: '2026-01-01', buyerName: 'No Contact Info' })
  const buyers = buildBuyers([d])
  check('Neither email nor phone present => not groupable, dog produces no buyer entry', buyers.length === 0)
}

// ── Per-dog relationship labelling (§5: Reserved vs Transferred) ──
{
  const reservedDog = dog({ id: 'r', reservedForEmail: 'x@example.com', reservedAt: '2026-01-01' })
  const transferredDog = dog({ id: 't', transferredAt: '2026-01-01', buyerEmail: 'y@example.com' })
  const b1 = buildBuyers([reservedDog])[0]
  const b2 = buildBuyers([transferredDog])[0]
  check('Reserved-only dog labelled "reserved"', b1.dogs[0].relationship === 'reserved')
  check('Transferred dog labelled "transferred"', b2.dogs[0].relationship === 'transferred')
}

// ── Sort order: most recent activity first ──
{
  const older = dog({ id: 'old', transferredAt: '2025-01-01', buyerEmail: 'a@example.com', buyerName: 'A Old' })
  const newer = dog({ id: 'new', transferredAt: '2026-01-01', buyerEmail: 'b@example.com', buyerName: 'B New' })
  const buyers = buildBuyers([older, newer])
  check('Buyers sorted by most recent activity first', buyers[0].email === 'b@example.com' && buyers[1].email === 'a@example.com')
}

summary()
