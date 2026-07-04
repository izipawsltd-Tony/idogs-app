# iDogs V1 — M7 Data Model Spec
**Reports · Puppies · Buyers**

> **Status: DESIGN — for approval before implementation. No code until approved.**
> Product boundary (locked): **iDogs = simple, affordable breeder SaaS.**
> Owner accounts, buyer login, Dog Passport / QR identity, lifetime ownership
> continuity, shared access, revoke/consent — all **out of scope → IZIPAWS.**

---

## 0. Locked decisions

| Item | Decision |
|---|---|
| Reports aggregate | (i) Client-side loop, **parallel** (`Promise.all`) |
| Report calculation | On-the-fly, no `reportSnapshots` collection |
| Report export | Reuse existing `/api/export-report` |
| Buyers | Option C — lightweight **derived** contact view (no collection) |
| Puppies | Puppy **is a Dog** + lightweight commercial lifecycle fields |
| Reservation | Yes, basic — `reservedForName/Email/Phone/At` (prospective) |
| Deposit | Yes, manual bookkeeping (status/amount/date) — **no** Stripe |
| Sale/transfer identity | `buyerName/Email/Phone` — written **only** on completion, never on reserve |
| `reservationStatus` | **Dropped** — `availabilityStatus` is the single source of truth |
| Real buyer account / Owner workspace | **Not built** (IZIPAWS) |
| `claimTransferredDogs` | Kept but **not** a core iDogs V1 flow — do not expand |
| Transfer `tenantId` | **Unchanged** — transferred dogs stay in breeder tenant |

---

## 1. New fields on `Dog` (Puppy commercial lifecycle)

All fields **optional** and **backward-compatible**. Existing dogs have them
`undefined`. **`undefined` = not tracked / not a sale item** — do NOT default an
existing breeding adult to `available`. Only puppies being sold get these set.

```ts
// Commercial state — SINGLE source of truth for the sales funnel.
// (No separate `reservationStatus` — 'reserved' is encoded here.)
availabilityStatus?: 'available' | 'reserved' | 'kept' | 'sold'

// Reservation details — PROSPECTIVE buyer. Written only while reserving.
// Present only when availabilityStatus === 'reserved'.
reservedForName?:   string
reservedForEmail?:  string
reservedForPhone?:  string
reservedAt?:        string   // ISO date

// Deposit — manual bookkeeping, orthogonal to availability. No Stripe.
depositStatus?:     'none' | 'pending' | 'received'
depositAmount?:     number   // AUD
depositReceivedAt?: string   // ISO date
```

Transfer/sale details live in the **buyer\*** fields (see §3), written only when
sale/transfer completes:

```ts
buyerName?:   string
buyerEmail?:  string
buyerPhone?:  string        // added in V1
transferredAt?: string      // ISO date
```

### 🔒 Locked rule — never mix prospective and completed buyer

**Reservation writes `reservedFor*` ONLY. Sale/transfer writes `buyer*` ONLY.**
A reservation must never populate `buyer*`; a completed transfer must never rely
on `reservedFor*`. This keeps **prospective buyer** (reserved) and **completed
buyer** (sold/transferred) cleanly separable so Reports (§4.4) and Buyers (§5)
can't confuse the two. When a reserved puppy is sold/transferred, the breeder
action copies the relevant details into `buyer*` and sets `status:'transferred'`
/ `availabilityStatus:'sold'` — it does not just rename the reservation.

- Confirmed: **drop `reservationStatus`** (single source of truth).
- Confirmed: **add `reservedForPhone` + `buyerPhone`**, both optional / not required.

---

## 2. Two independent axes: commercial vs ownership

The most important distinction. **Commercial state ≠ ownership state.** They are
set by different actions and can hold different values at the same time.

| Axis | Field | Values | Set by |
|---|---|---|---|
| **Commercial** | `availabilityStatus` | available · reserved · kept · sold | Puppies UI (breeder marks sale progress) |
| **Ownership** | `status` | active · transferred | Transfer flow (`transferDogOwnership`) |

Typical puppy funnel (each step is a separate breeder action):

```
available → reserved (+deposit pending/received) → sold → [transfer event] → transferred
   avail.      avail.=reserved                       avail.=sold    status=transferred
```

- A puppy can be `availabilityStatus:'sold'` **before** `status:'transferred'`
  (money settled, dog not handed over / paperwork pending).
- `kept` = breeder retains → never enters the sold/transferred path.
- Reports and Buyers read **both** axes; never conflate "sold" with "transferred".

---

## 3. Ownership model (unchanged — reference only)

No change requested; documented so implementation doesn't drift.

```
tenantId        = breeder workspace  → ALL queries filter where('tenantId','==',uid)
originBreederId = original breeder   → immutable provenance
currentOwnerId  = current owner
```

`transferDogOwnership(dogId, { buyerName, buyerEmail, transferredAt, microchipCertUrl? })`
sets `status:'transferred'` + buyer fields. **Does NOT change `tenantId`** → the
dog stays in the breeder tenant (that's why DogList has the "Transferred" toggle).

**Breeder retains a historical snapshot** of the dog and breeder-created records
up to the transfer date — **not** ongoing access to the dog's future record.
Reassignment to a real buyer account (`claimTransferredDogs` / server-side claim)
is **deferred to IZIPAWS** and stays dormant in V1.

*If phone is added:* extend the transfer payload with `buyerPhone?`.

---

## 4. Reports V1

**Cross-cutting rules (all four reports):**
- Fetch tenant-scoped via `getDogs()`, then any per-dog reads run **in parallel**:
  `await Promise.all(dogs.map(d => getHealthTests(d.id)))` — never sequential.
- **On-the-fly** each time the page opens. No stored snapshots, no cron.
- **No `orderBy()`** in any query (Firestore rule) — sort client-side.
- Export = existing `/api/export-report` (PDF/CSV). No new reporting backend.
- Upgrade trigger: only if real perf pain / large kennels → then a server
  `/api/reports` aggregate. Not before.

### 4.1 Breeding Overview
*(Renamed from "Kennel Compliance Overview" — iDogs must not imply legal
compliance verification. `breedingCompliance.ts` runs internal business rules.)*

- Source: `getDogs()` → run `breedingCompliance.ts` per dog.
- Display buckets — **no "Fail" wording**:

  | Bucket | From breedingCompliance status |
  |---|---|
  | **Eligible** | `ok` |
  | **Caution** | `caution`, `warn` |
  | **Review Required** | `blocked` (and any `fail`) |

- ✅ Verified map (from `breedingCompliance` / DogDetailPage status enum
  `ok · caution · warn · blocked · fail`):

### 4.2 Litter Production
- Source: `getLitters()`.
- Rows/metrics: litters by year (from `actualBirthDate` / whelp date),
  total puppies (`puppyIds.length`), average litter size, dam (`damId → name`),
  **sire if available**, whelp date.
- `Litter.sireId?: string | null` exists (verified); there is **no `sireName`**.
  Resolve sire via `getDog(sireId).name`; show "—" when `sireId` is null.
  `damId` is required → dam always resolvable.

### 4.3 Health Test Coverage
*(Wording: "Coverage", **not** "Health Compliance".)*
- Source: `getDogs()` → `Promise.all(getHealthTests(dogId))`.
- `HealthTest.testType` = `hip | elbow | eye | dna | cardiac | other` (verified).
  Cover the four core types **Hip · Elbow · Eye · DNA**; roll `cardiac`/`other`
  into an "Other" line. Per type: count dogs Covered vs Missing.
- **No "due for review" in V1** — `HealthTest` has only `dateTested`, **no expiry
  field** (verified). Per the "only if data supports" rule → **Covered / Missing
  only.** (A retest cadence would need a new field; out of scope for V1.)

### 4.4 Sales & Transfers
- Source: `getDogs()`.
- V1 metrics: transfers by month (`status:'transferred'`, group by
  `transferredAt` month), puppies sold/transferred, buyer name/email.
- After Puppy fields (§1) land, add funnel counts:
  **Available · Reserved · Deposit Received · Sold**.

---

## 5. Buyers V1 — Option C (derived view, no collection)

**No `buyers` collection.** Buyer = **breeder-owned contact record, derived**.

**Correctness rule:** derive by grouping the **already-fetched, tenant-scoped**
`getDogs()` result **client-side by email**.
**Do NOT call `getDogsByBuyerEmail`** for this page — that function queries
`where('buyerEmail','==',…)` with **no tenantId filter** (built for the
cross-breeder buyer-claim case) and would leak/most-likely be blocked by rules.

**Buyer set = UNION** (confirmed) of:
- `reservedForEmail` (dogs with `availabilityStatus:'reserved'`) — prospective, **and**
- `buyerEmail` (dogs with `status:'transferred'`) — completed

so a buyer appears from the reservation stage, matching the funnel.

**Grouping key:** **normalized email** (trim + lowercase). If a dog has no email,
**fall back to normalized phone** (`reservedForPhone` / `buyerPhone`). A contact
with neither email nor phone is not groupable → list its dog(s) individually.

**Per-dog relationship status** shown against each linked dog:
- **Reserved** — came in via `reservedForEmail` (prospective)
- **Transferred** — came in via `buyerEmail` (completed)

**Buyer summary shows:** name, email, phone, linked dogs/puppies, and each dog's
commercial + ownership status.

Example (derived, in-memory):
```
Sarah Wilson · sarah@email.com · 0412 345 678 · 2 dogs
   • Charlie  — sold · Transferred
   • Bella    — reserved · deposit received
```

> Because `reservedFor*` and `buyer*` are kept separate (§1 locked rule), the same
> person reserving one puppy and having already been transferred another shows
> correctly as one contact with two dogs at different funnel stages.

**Explicitly NOT in iDogs:** buyer login, Owner dashboard, Dog Passport, lifetime
ownership chain, shared documents, revoke access. → IZIPAWS.

---

## 6. Firestore constraints honored

- Queries: `where()` only, **no `orderBy()`** — sort/group client-side.
- Tenant scoping via `getDogs()` (`where tenantId == uid`); per-dog subreads
  (`getHealthTests` etc.) use `where dogId ==`.
- Per-dog reads run in parallel (`Promise.all`).
- All new `Dog` fields optional → no migration/backfill needed.
- `tenantId` never mutated on transfer.

---

## 7. Verification results (`src/types/index.ts`) — ✅ DONE

| # | Check | Result |
|---|---|---|
| 1 | Dog field collisions | None. **But** `buyerName/buyerEmail/transferredAt/status` are written to Firestore yet **undeclared** in `interface Dog` (accessed via `(dog as any)`). Formalize them — see §7a. |
| 2 | `Litter.sireId` | Exists (`?: string \| null`); no `sireName`. Resolve via `getDog(sireId)`. (§4.2) |
| 3 | `HealthTest.testType` | `hip\|elbow\|eye\|dna\|cardiac\|other`; **no expiry field** → Coverage = Covered/Missing only. (§4.3) |
| 4 | compliance enum | `ok\|caution\|warn\|blocked\|fail` → Eligible/Caution/Review map locked. (§4.1) |
| 5 | `buyerPhone` | Does not exist → clean to add. |

### 7a. `Dog` interface additions to formalize

Add these to `interface Dog` (all optional; several are already written today but
undeclared, so this only makes the type honest — no data migration):

```ts
// Ownership (already written by transferDogOwnership, currently undeclared)
status?: 'active' | 'transferred'
buyerName?:  string
buyerEmail?: string
buyerPhone?: string        // NEW
transferredAt?: string

// Commercial lifecycle (NEW — §1)
availabilityStatus?: 'available' | 'reserved' | 'kept' | 'sold'
reservedForName?:  string
reservedForEmail?: string
reservedForPhone?: string
reservedAt?:       string
depositStatus?:     'none' | 'pending' | 'received'
depositAmount?:     number
depositReceivedAt?: string
```
*(Also note: `pedigreeRegister` is used via `(dog as any)` and lives in
`DogFormData` but not `Dog` — worth adding while here, though not an M7 concern.)*

### 7b. Pre-existing types → IZIPAWS-target (LABELLED, kept, not built on)

`types/index.ts` declares **`BuyerRecord`, `Sale`, `OwnershipTransfer`,
`PassportVisibility`** — legacy from the original **IZIPAWS-first** plan (before
iDogs became the lightweight satellite). None are backed by any `db.ts`
collection/function.

**Usage search (in-hand files): zero runtime usage** — the four appear only at
their `interface` definitions. `Sale` also matches a UI string
`'Sale/Transfer Contract'` in DocumentsPage (label text, not the type). ✅
*Full-repo confirm still to run by Izi/Claude Code across `src/` + `api/`.*

**Decision (A — locked):** iDogs V1 uses **fields-on-`Dog`** for the commercial
lifecycle (§1) and a **derived Buyers view** (§5). **Do NOT create `BuyerRecord`
or `Sale` collections / APIs / CRUD.** `OwnershipTransfer` + `PassportVisibility`
are outside iDogs V1 (IZIPAWS identity layer).

The four types are **kept, not deleted** — they are the **migration TARGET** for
when iDogs data later graduates to IZIPAWS (real Buyers, sales history,
invite-based transfer, QR passport permissions). They are now **labelled
inactive** in `types/index.ts` (block comment: "IZIPAWS-TARGET SCHEMA — NOT USED
BY iDogs V1") so neither a human nor Claude Code mistakes them for the active
model.

**V1 stores current commercial state, not full reservation/sales history** —
intentional. Normalize to `Buyers`/`Sales` later **only if** real usage proves a
need for history, repeat reservations, or CRM.

---

## 8. Build order (per Izi)

1. **Reports V1** — 4 report types (§4).
2. **Puppy lifecycle fields** — `availabilityStatus` available/reserved/kept/sold (§1).
3. **Basic reservation** — `reservedFor*` (§1).
4. **Manual deposit tracking** — `deposit*` (§1).
5. **Buyers lightweight view** — Option C derived (§5).
6. **Staging E2E** — full funnel test (available → reserved → deposit → sold →
   transferred → visible in breeder history).

Do **not** expand `claimTransferredDogs` / buyer-account claim in V1.
