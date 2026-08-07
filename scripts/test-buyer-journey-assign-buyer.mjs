// scripts/test-buyer-journey-assign-buyer.mjs — Buyer Journey V1: the
// Enquiry -> Assign Buyer connector added to LittersPage.tsx.
//
// The pure decision/derivation logic (enquiryMatchesReservation,
// hasConflictingReservation, buildAssignBuyerUpdate) was extracted into
// src/lib/assignBuyer.ts specifically so this suite imports the REAL
// production code (Node can execute a plain, JSX-free .ts module directly
// — same approach already established for saleAvailabilityError.ts), not a
// hand-maintained mirror that could silently drift. handleAssignBuyer()
// itself is a closure inside LittersPage.tsx (a large component file with
// Firebase/router imports, not something a plain Node script can mount) —
// its ORCHESTRATION shape (busy-state guard, confirm gate, try/catch/
// finally) is faithfully mirrored in a small harness below that calls the
// REAL imported decision functions, exactly the "wrap the real pattern in
// a harness when the component itself isn't importable" approach already
// used in scripts/test-sale-availability-error-sanitization.mjs (Section
// 10). Separate structural checks against the actual LittersPage.tsx
// source confirm the real file's shape matches what the harness assumes.
//
// Usage: node scripts/test-buyer-journey-assign-buyer.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { enquiryMatchesReservation, hasConflictingReservation, buildAssignBuyerUpdate } from '../src/lib/assignBuyer.ts'

const { check, summary } = makeChecker()

function enq(overrides = {}) {
  return { id: 'enq1', tenantId: 'breeder1', litterId: 'litter1', puppyId: 'puppyA', name: 'Jane Buyer', email: 'jane@example.com', phone: '0412345678', message: 'Interested!', createdAt: '2026-08-01T00:00:00.000Z', notified: true, ...overrides }
}
function puppy(overrides = {}) {
  return { id: 'puppyA', tenantId: 'breeder1', name: 'Rex', sex: 'male', status: 'active', ...overrides }
}

// =========================================================================
// SECTION 1 — buildAssignBuyerUpdate(): field mapping + reservedAt format
// =========================================================================
{
  const fixedNow = new Date('2026-08-07T03:15:00.000Z')
  const updates = buildAssignBuyerUpdate(enq(), fixedNow)
  check('availabilityStatus becomes reserved', updates.availabilityStatus === 'reserved')
  check('reservedForName maps from enquiry name', updates.reservedForName === 'Jane Buyer')
  check('reservedForEmail maps from enquiry email', updates.reservedForEmail === 'jane@example.com')
  check('reservedForPhone maps from enquiry phone', updates.reservedForPhone === '0412345678')
  check('reservedAt uses the SAME established format as SaleAvailabilityPanel (new Date().toISOString().split(\'T\')[0])',
    updates.reservedAt === fixedNow.toISOString().split('T')[0])
  check('reservedAt is a plain YYYY-MM-DD string, not an ISO timestamp with time', /^\d{4}-\d{2}-\d{2}$/.test(updates.reservedAt))
  check('no extra/unexpected keys beyond the documented reservation fields',
    Object.keys(updates).sort().join(',') === ['availabilityStatus', 'reservedAt', 'reservedForEmail', 'reservedForName', 'reservedForPhone'].sort().join(','))
}

// null/absent email or phone must be OMITTED, never sent as undefined
// (updateDoc() rejects undefined field values outright).
{
  const updates = buildAssignBuyerUpdate(enq({ email: null, phone: null }))
  check('a null enquiry email is omitted from the update object (never sent as undefined)', !('reservedForEmail' in updates))
  check('a null enquiry phone is omitted from the update object (never sent as undefined)', !('reservedForPhone' in updates))
  check('reservedForName and availabilityStatus/reservedAt are still present with a phone/email-less enquiry',
    updates.reservedForName === 'Jane Buyer' && updates.availabilityStatus === 'reserved' && typeof updates.reservedAt === 'string')
  check('no value anywhere in the update object is literally undefined (would crash updateDoc())',
    Object.values(updates).every(v => v !== undefined))
}

// =========================================================================
// SECTION 2 — enquiryMatchesReservation() / hasConflictingReservation():
// the data-integrity guard's decision logic
// =========================================================================
{
  // No existing reservation at all -> not a conflict, not yet "matches"
  check('an available/unreserved puppy has no conflicting reservation', hasConflictingReservation(enq(), puppy({ availabilityStatus: 'available' })) === false)
  check('an available/unreserved puppy does not read as already-matching', enquiryMatchesReservation(enq(), puppy({ availabilityStatus: 'available' })) === false)

  // Reserved for the SAME buyer (by email) -> idempotent match, no conflict
  const samePuppy = puppy({ availabilityStatus: 'reserved', reservedForEmail: 'jane@example.com', reservedForName: 'Jane Buyer' })
  check('reserved for the same buyer email: matches (idempotent-safe)', enquiryMatchesReservation(enq(), samePuppy) === true)
  check('reserved for the same buyer email: not flagged as a conflict', hasConflictingReservation(enq(), samePuppy) === false)

  // Email match is case/whitespace-insensitive
  const sameCasedPuppy = puppy({ availabilityStatus: 'reserved', reservedForEmail: '  Jane@Example.com  ' })
  check('email match is case- and whitespace-insensitive', enquiryMatchesReservation(enq(), sameCasedPuppy) === true)

  // Reserved for a DIFFERENT buyer -> real conflict, must not silently overwrite
  const differentPuppy = puppy({ availabilityStatus: 'reserved', reservedForEmail: 'other@example.com', reservedForName: 'Other Buyer' })
  check('reserved for a different buyer email: does NOT match', enquiryMatchesReservation(enq(), differentPuppy) === false)
  check('reserved for a different buyer email: IS flagged as a conflict', hasConflictingReservation(enq(), differentPuppy) === true)

  // 'sold' is treated the same as 'reserved' for conflict purposes
  const soldPuppy = puppy({ availabilityStatus: 'sold', reservedForEmail: 'other@example.com' })
  check('a SOLD puppy for a different buyer is also flagged as a conflict (not just reserved)', hasConflictingReservation(enq(), soldPuppy) === true)

  // Phone-only enquiry (no email on either side) falls back to name
  const phoneOnlyEnq = enq({ email: null })
  const nameOnlyPuppy = puppy({ availabilityStatus: 'reserved', reservedForName: 'Jane Buyer', reservedForEmail: undefined })
  check('phone-only enquiry + name-only reservation: falls back to name match', enquiryMatchesReservation(phoneOnlyEnq, nameOnlyPuppy) === true)
  const differentNameOnlyPuppy = puppy({ availabilityStatus: 'reserved', reservedForName: 'Someone Else', reservedForEmail: undefined })
  check('phone-only enquiry against a different name-only reservation: does not match', enquiryMatchesReservation(phoneOnlyEnq, differentNameOnlyPuppy) === false)

  // If EITHER side has an email on file, email is authoritative even if names differ/are blank
  const emailAuthoritativePuppy = puppy({ availabilityStatus: 'reserved', reservedForEmail: 'jane@example.com', reservedForName: '' })
  check('email is authoritative over name when present on the puppy side', enquiryMatchesReservation(enq(), emailAuthoritativePuppy) === true)
}

// =========================================================================
// SECTION 3 — behavioral harness: handleAssignBuyer's orchestration,
// wired to the REAL imported decision functions + buildAssignBuyerUpdate
// =========================================================================
function createAssignBuyerHarness(initialDogs) {
  let dogs = [...initialDogs]
  const busy = {}
  const errors = {}
  const toasts = []
  const confirmCalls = []
  let confirmReturn = true
  let updateDogShouldFail = false

  async function updateDogFake(id, updates) {
    if (updateDogShouldFail) throw Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    dogs = dogs.map(d => (d.id === id ? { ...d, ...updates } : d))
  }

  async function handleAssignBuyer(enquiry, targetPuppy) {
    if (busy[enquiry.id]) return
    if (targetPuppy.status === 'restricted') {
      toasts.push({ msg: 'RESTRICTED', type: 'error' })
      return
    }
    const reservedLike = targetPuppy.availabilityStatus === 'reserved' || targetPuppy.availabilityStatus === 'sold'
    if (reservedLike && enquiryMatchesReservation(enquiry, targetPuppy)) {
      toasts.push({ msg: 'ALREADY_ASSIGNED', type: undefined })
      return
    }
    if (hasConflictingReservation(enquiry, targetPuppy)) {
      confirmCalls.push(enquiry.id)
      if (!confirmReturn) return
    }
    busy[enquiry.id] = true
    errors[enquiry.id] = ''
    try {
      const updates = buildAssignBuyerUpdate(enquiry)
      await updateDogFake(targetPuppy.id, updates)
      toasts.push({ msg: 'ASSIGNED', type: undefined })
    } catch {
      errors[enquiry.id] = 'ERR'
      toasts.push({ msg: 'ERR', type: 'error' })
    } finally {
      busy[enquiry.id] = false
    }
  }

  return {
    handleAssignBuyer,
    getDogs: () => dogs,
    getBusy: () => busy,
    getErrors: () => errors,
    getToasts: () => toasts,
    getConfirmCalls: () => confirmCalls,
    setConfirmReturn: v => { confirmReturn = v },
    setUpdateDogShouldFail: v => { updateDogShouldFail = v },
  }
}

// 1/2/3/4 — puppy-specific enquiry assignable, correct puppyId used, fields
// map correctly, availabilityStatus becomes reserved
{
  const unrelated = puppy({ id: 'puppyB', name: 'Buddy', availabilityStatus: 'available' })
  const target = puppy({ id: 'puppyA', name: 'Rex', availabilityStatus: 'available' })
  const h = createAssignBuyerHarness([target, unrelated])
  await h.handleAssignBuyer(enq({ puppyId: 'puppyA' }), target)
  const after = h.getDogs().find(d => d.id === 'puppyA')
  check('SCENARIO 1/4: puppy-specific enquiry assignable, availabilityStatus becomes reserved', after.availabilityStatus === 'reserved')
  check('SCENARIO 2: correct puppyId (puppyA) was updated', after.id === 'puppyA')
  check('SCENARIO 3: enquiry name/email/phone mapped to the matching reservedFor* fields',
    after.reservedForName === 'Jane Buyer' && after.reservedForEmail === 'jane@example.com' && after.reservedForPhone === '0412345678')
  check('SCENARIO 7: an unrelated puppy in the same litter is left completely untouched',
    h.getDogs().find(d => d.id === 'puppyB').availabilityStatus === 'available')
  check('a success toast was shown', h.getToasts().some(t => t.msg === 'ASSIGNED'))
  check('busy flag is cleared after completion (no stuck spinner)', h.getBusy()[enq().id] === false)
}

// 5/6 — existing reservation not silently overwritten; same-buyer idempotent
// case is safe
{
  // Different buyer already reserved: must prompt for confirmation, and a
  // declined confirmation must leave the puppy's reservation UNCHANGED.
  const target = puppy({ id: 'puppyA', availabilityStatus: 'reserved', reservedForEmail: 'other@example.com', reservedForName: 'Other Buyer' })
  const h = createAssignBuyerHarness([target])
  h.setConfirmReturn(false)
  await h.handleAssignBuyer(enq(), target)
  check('SCENARIO 5: a conflicting reservation triggers an explicit confirmation prompt', h.getConfirmCalls().length === 1)
  check('SCENARIO 5: declining the confirmation leaves the existing (different) buyer\'s reservation untouched',
    h.getDogs().find(d => d.id === 'puppyA').reservedForEmail === 'other@example.com')
  check('SCENARIO 5: no write/toast happened for the declined overwrite', h.getToasts().length === 0)
}
{
  // Different buyer, confirmation ACCEPTED: overwrite proceeds (explicit,
  // deliberate breeder action — not a silent overwrite).
  const target = puppy({ id: 'puppyA', availabilityStatus: 'reserved', reservedForEmail: 'other@example.com', reservedForName: 'Other Buyer' })
  const h = createAssignBuyerHarness([target])
  h.setConfirmReturn(true)
  await h.handleAssignBuyer(enq(), target)
  check('SCENARIO 5: confirming the overwrite reassigns to the new buyer', h.getDogs().find(d => d.id === 'puppyA').reservedForEmail === 'jane@example.com')
}
{
  // Same buyer already assigned: idempotent no-op, no confirmation, no write.
  const target = puppy({ id: 'puppyA', availabilityStatus: 'reserved', reservedForEmail: 'jane@example.com', reservedForName: 'Jane Buyer' })
  const h = createAssignBuyerHarness([target])
  await h.handleAssignBuyer(enq(), target)
  check('SCENARIO 6: re-assigning the SAME buyer never prompts for confirmation', h.getConfirmCalls().length === 0)
  check('SCENARIO 6: re-assigning the SAME buyer produces the distinct "already assigned" toast, not "assigned"',
    h.getToasts().some(t => t.msg === 'ALREADY_ASSIGNED') && !h.getToasts().some(t => t.msg === 'ASSIGNED'))
  check('SCENARIO 6: the puppy document is left byte-for-byte unchanged (no unnecessary write)',
    JSON.stringify(h.getDogs().find(d => d.id === 'puppyA')) === JSON.stringify(target))
}

// Restricted (over-plan-cap) puppy: mirrors handleSavePuppy/SaleAvailabilityPanel's
// established short-circuit — never attempts the write at all.
{
  const target = puppy({ id: 'puppyA', status: 'restricted', availabilityStatus: 'available' })
  const h = createAssignBuyerHarness([target])
  await h.handleAssignBuyer(enq(), target)
  check('a restricted puppy never gets its availabilityStatus written', h.getDogs().find(d => d.id === 'puppyA').availabilityStatus === 'available')
  check('a restricted puppy surfaces the plan-limit message, not a save-succeeded one', h.getToasts().some(t => t.msg === 'RESTRICTED'))
}

// Save failure: busy clears, error is surfaced, no partial local state drift.
{
  const target = puppy({ id: 'puppyA', availabilityStatus: 'available' })
  const h = createAssignBuyerHarness([target])
  h.setUpdateDogShouldFail(true)
  await h.handleAssignBuyer(enq(), target)
  check('a failed save leaves the puppy\'s availabilityStatus unchanged (never optimistically applied before the write settles)',
    h.getDogs().find(d => d.id === 'puppyA').availabilityStatus === 'available')
  check('a failed save clears the busy flag (button re-enables)', h.getBusy()[enq().id] === false)
  check('a failed save surfaces an error toast', h.getToasts().some(t => t.type === 'error'))
}

// =========================================================================
// SECTION 4 — downstream contract remains intact (Scenario 8): Private
// Access reads reservedForEmail, Transfer prefills reservedForName/email/
// phone — this connector must write into exactly those field NAMES, not a
// new shape.
// =========================================================================
{
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

  check('updateDog() is the single write path this connector uses (no bespoke write helper introduced)',
    /export async function updateDog\(id: string, data: Partial<Dog>\): Promise<void>/.test(dbSrc))

  check('LittersPage.tsx\'s private-access flow pre-fills the buyer email from reservedForEmail (unchanged downstream contract)',
    /privateAccessEmails\[puppy\.id\] \?\? puppy\.reservedForEmail \?\? ''/.test(littersSrc))
  check('LittersPage.tsx\'s own inline Transfer modal still prefills from reservedForName/Email/Phone',
    /reservedForName/.test(littersSrc) && /reservedForEmail/.test(littersSrc) && /reservedForPhone/.test(littersSrc))
  check('DogDetailPage.tsx\'s Transfer modal still prefills initialBuyerName/Email/Phone from reservedFor* (unchanged downstream contract)',
    /initialBuyerName=\{dog\.reservedForName/.test(detailSrc) && /reservedForEmail/.test(detailSrc))
}

// =========================================================================
// SECTION 5 — structural checks against the real LittersPage.tsx: the
// connector is wired the way the harness above assumes, mirrors
// SaleAvailabilityPanel's established semantics, and stays in-scope
// =========================================================================
{
  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')

  check('LittersPage.tsx imports the real pure decision functions from ../lib/assignBuyer (not an inline reimplementation)',
    /import\s*\{\s*enquiryMatchesReservation,\s*hasConflictingReservation,\s*buildAssignBuyerUpdate\s*\}\s*from\s*'\.\.\/lib\/assignBuyer'/.test(littersSrc))
  check('LittersPage.tsx defines handleAssignBuyer', /async function handleAssignBuyer\(enq: ShowcaseEnquiry, puppy: Dog\)/.test(littersSrc))
  check('handleAssignBuyer calls the real updateDog() (reused, not a new write function)', /await updateDog\(puppy\.id, updates\)/.test(littersSrc))
  check('handleAssignBuyer derives updates via the real buildAssignBuyerUpdate(enq)', /const updates = buildAssignBuyerUpdate\(enq\)/.test(littersSrc))
  check('handleAssignBuyer mirrors handleSavePuppy/SaleAvailabilityPanel\'s restricted short-circuit',
    /if \(\(puppy as any\)\.status === 'restricted'\)/.test(littersSrc))
  check('a conflicting reservation is gated behind an explicit window.confirm (matches this file\'s existing confirm() convention)',
    /if \(hasConflictingReservation\(enq, puppy\)\) \{[\s\S]{0,200}if \(!window\.confirm\(/.test(littersSrc))
  check('local dogs state is updated after a successful write (Scenario: rendered state reflects the new reservation without a manual workaround)',
    /setDogs\(prev => prev\.map\(d => \(d\.id === puppy\.id \? \{ \.\.\.d, \.\.\.updates \} : d\)\)\)/.test(littersSrc))
  check('save failures route through the existing describeSaleAvailabilitySaveFailure sanitizer (existing UI/error convention, not a bespoke one)',
    /describeSaleAvailabilitySaveFailure\(e\)/.test(littersSrc))

  // Scenario 1/9: the button only renders for puppy-specific enquiries
  // (aboutPuppy truthy) and the existing enquiry rendering (name/email/
  // phone/message/notified-warning) is untouched.
  check('SCENARIO 9: existing enquiry rendering (name/email/phone/message) is still present and untouched',
    /\{enq\.email && <span>\{enq\.email\}<\/span>\}/.test(littersSrc) && /\{enq\.message\}/.test(littersSrc))
  check('SCENARIO 9: the "Not emailed" notice for un-notified enquiries is still present and untouched',
    /Not emailed — reply directly using the contact details above/.test(littersSrc))
  check('SCENARIO 1: the Assign Buyer control is gated on aboutPuppy (only rendered for puppy-specific enquiries, general enquiries untouched)',
    /\{aboutPuppy && \([\s\S]{0,1000}assignBuyerBusy\[enq\.id\]/.test(littersSrc))
  check('the busy/error state is keyed per-enquiry (Record<string, ...>), mirroring this file\'s established privateAccessBusy pattern',
    /const \[assignBuyerBusy, setAssignBuyerBusy\] = useState<Record<string, boolean>>\(\{\}\)/.test(littersSrc) &&
    /const \[assignBuyerErrors, setAssignBuyerErrors\] = useState<Record<string, string>>\(\{\}\)/.test(littersSrc))
  check('the Assign Buyer button is disabled while its own enquiry is busy (no duplicate-click races)',
    /disabled=\{!!assignBuyerBusy\[enq\.id\]\}/.test(littersSrc))

  // Out-of-scope guard: this connector must not touch anything the spec
  // explicitly excludes.
  check('OUT OF SCOPE: no new Firestore collection is referenced for buyer assignment (still only the dogs collection via updateDog)',
    !/collection\(db, 'buyerAssignments'/.test(littersSrc) && !/collection\(db, 'reservations'/.test(littersSrc))
  check('OUT OF SCOPE: no new API route is called for this connector (client-side updateDog only, same as SaleAvailabilityPanel)',
    !/fetch\(['"`]\/api\/assign-buyer/.test(littersSrc))
}

// =========================================================================
// SECTION 6 — Rules/data-model non-regression: reservation fields remain
// outside dogProtectedFieldsUnchanged(), so no firestore.rules change was
// needed or made for this connector to work.
// =========================================================================
{
  const rulesSrc = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  check('firestore.rules\' protected-fields list still does NOT include the reservation fields this connector writes (unchanged, as required)',
    !/dogProtectedFieldsUnchanged[\s\S]{0,400}reservedForName/.test(rulesSrc))
  check('firestore.rules has no new dedicated buyer-assignment collection rule', !/match \/buyerAssignments\//.test(rulesSrc))
}

await summary()
