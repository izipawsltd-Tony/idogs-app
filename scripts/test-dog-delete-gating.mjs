// scripts/test-dog-delete-gating.mjs — structural/mirror regression tests
// for the Dog Detail Delete-button gating fix: a Pet Owner previously saw
// a working-looking Delete button on any dog, including ones firestore.
// rules' dogs delete rule permanently protects (any dog carrying transfer/
// claim history) — clicking it always failed with a bare "Failed to
// delete", the actual cause (Rules denial) never surfaced.
//
// Follows this repo's established convention (see test-pricing-
// integration-checks.mjs, test-reminders-batch-regression.mjs) of
// mirroring app logic in-file rather than importing src/lib/utils.ts or
// src/pages/DogDetailPage.tsx directly — DogDetailPage.tsx pulls in
// src/lib/firebase.ts (Vite-only `import.meta.env`), so it cannot be
// safely dynamically imported from a plain Node script. The mirror below
// is checked against utils.ts's actual exported source text to keep both
// copies honest.
//
// Real Rules-emulator coverage (proving direct deletion is denied by the
// ACTUAL Firestore rule, not just this mirror) is in
// scripts/test-dog-delete-rules-emulator.mjs.
//
// Usage: node scripts/test-dog-delete-gating.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const utilsSrc = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
const dogDetailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

// ── Mirror of src/lib/utils.ts's isDogHistoryBearing/isDogTransferred/isDogDeletableByUser ──

const HISTORY_FIELDS = ['buyerEmail', 'previousOwnerId', 'transferredAt', 'claimedAt', 'claimedBy']

function isDogHistoryBearing(dog) {
  return HISTORY_FIELDS.some(f => Object.prototype.hasOwnProperty.call(dog, f))
}
function isDogTransferred(dog) {
  return dog.status === 'transferred' || dog.transferStatus === 'pendingClaim'
}
function isDogDeletableByUser(dog, userId) {
  if (!userId || dog.currentOwnerId !== userId) return false
  if (isDogTransferred(dog)) return false
  if (isDogHistoryBearing(dog)) return false
  return true
}

// ── utils.ts source confirms the real exports match this mirror exactly ──

check(
  'utils.ts exports isDogHistoryBearing() checking the same 5 history fields',
  /DOG_HISTORY_FIELD_NAMES = \[.*'buyerEmail'.*'previousOwnerId'.*'transferredAt'.*'claimedAt'.*'claimedBy'.*\]/.test(utilsSrc) &&
    /export function isDogHistoryBearing/.test(utilsSrc)
)
check(
  'utils.ts exports isDogDeletableByUser() gating on currentOwnerId, isDogTransferred(), and isDogHistoryBearing()',
  /export function isDogDeletableByUser/.test(utilsSrc) &&
    /dog\.currentOwnerId !== userId/.test(utilsSrc) &&
    /isDogTransferred\(dog\)/.test(utilsSrc) &&
    /isDogHistoryBearing\(dog/.test(utilsSrc)
)

const BREEDER = 'breederA'
const OWNER = 'ownerB'
const STRANGER = 'strangerC'

// ── Required scenario 1: transferred/claimed dog — Delete unavailable ──

check(
  'Breeder viewing own dog mid-pendingClaim (currentOwnerId still breeder, status=transferred): Delete unavailable',
  !isDogDeletableByUser(
    { currentOwnerId: BREEDER, status: 'transferred', transferStatus: 'pendingClaim', previousOwnerId: BREEDER, buyerEmail: 'x@example.com', transferredAt: '2026-01-01' },
    BREEDER
  )
)
check(
  'Breeder viewing a dog already claimed by someone else (currentOwnerId reassigned to buyer): Delete unavailable',
  !isDogDeletableByUser(
    { currentOwnerId: OWNER, status: 'active', previousOwnerId: BREEDER, buyerEmail: 'x@example.com', transferredAt: '2026-01-01', claimedAt: '2026-01-02', claimedBy: OWNER },
    BREEDER
  )
)

// ── Required scenario 2: breeder-issued claimed dog — Delete unavailable
//    (status back to 'active' after claim — isDogTransferred() alone
//    would miss this; only the history-field check catches it) ──

check(
  'Owner viewing their OWN claimed dog (status reverted to active, history fields present): Delete unavailable',
  !isDogDeletableByUser(
    { currentOwnerId: OWNER, status: 'active', previousOwnerId: BREEDER, buyerEmail: 'x@example.com', transferredAt: '2026-01-01', claimedAt: '2026-01-02', claimedBy: OWNER },
    OWNER
  )
)
check(
  'Same claimed dog while restricted (over plan cap) rather than active: Delete STILL unavailable',
  !isDogDeletableByUser(
    { currentOwnerId: OWNER, status: 'restricted', previousOwnerId: BREEDER, buyerEmail: 'x@example.com', transferredAt: '2026-01-01', claimedAt: '2026-01-02', claimedBy: OWNER },
    OWNER
  )
)
check(
  'isDogTransferred() alone (without the history check) would have WRONGLY called the claimed-active dog deletable — confirms the history check is load-bearing, not redundant',
  isDogTransferred({ status: 'active', previousOwnerId: BREEDER, buyerEmail: 'x@example.com', transferredAt: '2026-01-01', claimedAt: '2026-01-02', claimedBy: OWNER }) === false
)

// ── Required scenario 3: eligible never-transferred dog — existing Delete behaviour preserved ──

check(
  'Owner-created dog, never transferred, no history fields: Delete remains available',
  isDogDeletableByUser({ currentOwnerId: OWNER, status: 'active' }, OWNER)
)
check(
  'Restricted (over-cap) dog that was NEVER transferred: Delete remains available (Rules only exclude literal transferred status + history fields, not restricted/archived)',
  isDogDeletableByUser({ currentOwnerId: OWNER, status: 'restricted' }, OWNER)
)
check(
  'Archived dog that was NEVER transferred: Delete remains available',
  isDogDeletableByUser({ currentOwnerId: OWNER, status: 'archived' }, OWNER)
)
check(
  'Unrelated stranger (no ownership at all) cannot delete an eligible dog either',
  !isDogDeletableByUser({ currentOwnerId: OWNER, status: 'active' }, STRANGER)
)

// ── DogDetailPage.tsx wiring: gating actually applied to the Delete button ──

check(
  'DogDetailPage.tsx imports the shared gating helpers from utils.ts (not a separate ad-hoc copy)',
  /isDogTransferred, isDogHistoryBearing, isDogDeletableByUser/.test(dogDetailSrc)
)
check(
  'DogDetailPage.tsx computes canDeleteDog from isCurrentEffectiveOwner + !dogIsMidTransfer + !dogHasPermanentHistory',
  /const canDeleteDog = isCurrentEffectiveOwner && !dogIsMidTransfer && !dogHasPermanentHistory/.test(dogDetailSrc)
)
check(
  'DogDetailPage.tsx computes isCurrentEffectiveOwner from dog.currentOwnerId === user?.uid (dog-intrinsic, not profile/role-based)',
  /const isCurrentEffectiveOwner = dog\.currentOwnerId === user\?\.uid/.test(dogDetailSrc)
)
check(
  'Delete button is disabled (not just visually styled) when !canDeleteDog',
  /disabled=\{deleting \|\| !canDeleteDog\}/.test(dogDetailSrc)
)
check(
  'Delete button onClick is gated to canDeleteDog (clicking while blocked cannot invoke handleDelete)',
  /onClick=\{canDeleteDog \? handleDelete : undefined\}/.test(dogDetailSrc)
)
check(
  'Delete button carries a title/tooltip explaining WHY it is blocked (clear user-facing guidance)',
  /title=\{deleteBlockedReason\}/.test(dogDetailSrc)
)
check(
  'Delete button is hidden entirely (not just disabled) for a non-current-owner viewer',
  /\{isCurrentEffectiveOwner && \(\s*<button[\s\S]{0,200}onClick=\{canDeleteDog \? handleDelete/.test(dogDetailSrc)
)

// ── Archive-instead guidance (existing Archive capability, not a new data model) ──

check(
  'DogDetailPage.tsx offers "Archive this dog" as the alternative action specifically when history-bearing, not mid-transfer, and not already archived',
  /const canOfferArchiveInsteadOfDelete = isCurrentEffectiveOwner && dogHasPermanentHistory && !dogIsMidTransfer && !isArchived/.test(dogDetailSrc)
)
check(
  'The archive-instead banner calls the EXISTING handleSetDogStatus(\'archive\') — no new endpoint or data model introduced',
  /\{canOfferArchiveInsteadOfDelete && \([\s\S]{0,700}handleSetDogStatus\('archive'\)/.test(dogDetailSrc)
)

// ── Improved fallback error message (no longer a bare "Failed to delete" on an unexpected Rules denial) ──

check(
  'handleDelete() re-checks isDogDeletableByUser() itself before attempting deletion (defense in depth against stale client state)',
  /if \(!isDogDeletableByUser\(dog, user\?\.uid \|\| ''\)\)/.test(dogDetailSrc)
)
check(
  'handleDelete()\'s catch block distinguishes a permission-denied Rules rejection from a generic failure using safeReadFirestoreErrorCode',
  /const code = safeReadFirestoreErrorCode\(err\)/.test(dogDetailSrc) &&
    /code === 'permission-denied'/.test(dogDetailSrc) &&
    /ownership\/transfer history that permanently protects it from deletion/.test(dogDetailSrc)
)
check(
  'The generic (non-permission-denied) fallback message is still distinct and still present',
  /'Failed to delete — please try again'/.test(dogDetailSrc)
)

// ── Role-switching / reload robustness: the gating never reads profile/role state ──

check(
  'isDogDeletableByUser() signature takes only (dog, userId) — no profile/role parameter, so its answer cannot depend on account role or a stale role cache',
  /export function isDogDeletableByUser\(dog: Dog, userId: string\): boolean/.test(utilsSrc)
)
check(
  'canDeleteDog/isCurrentEffectiveOwner in DogDetailPage.tsx are computed from dog + user.uid only, never from `profile` (role) — confirms role-switch/reload cannot expose or hide the action incorrectly',
  !/isCurrentEffectiveOwner[\s\S]{0,10}profile/.test(dogDetailSrc) &&
    !/canDeleteDog[\s\S]{0,10}profile/.test(dogDetailSrc)
)

await summary()
