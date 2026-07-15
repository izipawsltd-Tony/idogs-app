# ADR-001: Dog Origin & Provenance Model

## Status
Accepted — Phase 1 implementation plan commissioned. Open Questions 1 and 2 (below) are resolved by this approval; Open Question 3 remains open and does not block Phase 1.

## Date
2026-07-13 (approved 2026-07-13)

---

## Context

iDogs is repositioning around a core principle: **every dog deserves a Dog ID**, regardless of whether that dog's first record was created by a breeder or by the pet owner directly (e.g. rescue, older, imported, or otherwise non-breeder-sourced dogs).

The current data model (`Dog` in `src/types/index.ts`, write path in `src/lib/db.ts`) was built breeder-first and has been proven correct and robust across three separate fix cycles this engagement (claimed-dog reminders on Dog Detail, on the aggregate Reminders page, and on the Dashboard). The architecture audit (prior task, this session) confirmed:

- `tenantId` is already, in practice and by explicit code comment in `api/claim-transferred-dogs.js`, a **permanent provenance anchor** — set once at creation, never reassigned by transfer or claim.
- `currentOwnerId` is already the **current holder** field, reassigned by the claim API.
- `originBreederId` is written once at creation (always numerically equal to `tenantId` at that instant) but is **never read anywhere in `src/`** — it is dead data today.
- There is currently **no field anywhere that distinguishes how a Dog ID came to exist** — a breeder-issued dog and an owner-entered rescue dog are indistinguishable in storage.
- `createDog()` has no role gate and no plan gate beyond the free-tier dog-count limit, which applies identically to every account. Mechanically, any signed-in user can already create a dog, get a QR passport, and use every feature. The gap is entirely in classification, display, and UI shaping — not in access control.
- Signup's Pet Owner/Breeder selector does not currently reach the stored `role` field (separate, already-identified bug; referenced here for context, not resolved by this ADR — see §Open Questions).

This ADR defines the minimal, additive data model needed to make "Dog ID origin" a real, queryable, displayable concept — without touching the ownership/transfer/claim mechanics that are already correct and load-bearing.

---

## Decision

### 1. `sourceType` enum (new field on `Dog`)

```
sourceType: 'BREEDER_ISSUED' | 'OWNER_CREATED' | 'IMPORTED'
```

- Set once, at creation, by the creation flow based on which entry path was used.
- **Never reassigned** by transfer or claim — origin describes how the record began, not who holds it now.
- `IMPORTED` is defined here for schema completeness only; no import workflow is built in this phase (see §Decision 5).

### 2. Field semantics (confirms and formalizes existing behavior)

| Field | Semantics | Mutability |
|---|---|---|
| `tenantId` | Immutable provenance / original issuing tenant. The permanent anchor the entire ownership model already depends on. | **Never reassigned**, including on claim or transfer. No change from current behavior. |
| `currentOwnerId` | Current owner's user ID. | Changes on claim (server-side, `/api/claim-transferred-dogs.js`). No change from current behavior. |
| `createdByUserId` (new) | The user who first created this Dog ID record. Numerically equal to `tenantId` for every dog created under the current or proposed model, but semantically distinct: `tenantId` is about provenance-for-ownership-logic, `createdByUserId` is about authorship. | Immutable, set once at creation. |
| `originBreederId` | Retained, unchanged, for backward compatibility. Continues to be set to `tenantId` at creation for `BREEDER_ISSUED` dogs (and, per Decision 4, is `null`/absent for `OWNER_CREATED` dogs going forward). Not deprecated by removal — deprecated by no longer being the primary signal anything reads. | Immutable, set once at creation (unchanged from today). |
| `issuedByOrganisationId` | **Not needed now.** There is no organisation/kennel entity distinct from a user account today — `kennelName` is a plain string on `UserProfile`, not a linked entity. Introducing this field now would be speculative. Revisit only if/when a real multi-user-per-kennel need appears. | N/A — not added in this phase. |

### 3. Defaults for existing dogs (backward compatibility)

Every dog currently in Firestore (`idogs-app` and `idogs-app-staging`) was created via the current `createDog()`, which always sets `tenantId = originBreederId = currentOwnerId = uid()` at creation. Because the product has only ever shipped the breeder-shaped creation form, **every existing record is safely and unambiguously classifiable as `BREEDER_ISSUED`** — this is not a guess, it's a fact about the only code path that has ever written a `Dog` document.

Read-time default, applied without a migration:

```
sourceType = dog.sourceType ?? 'BREEDER_ISSUED'
createdByUserId = dog.createdByUserId ?? dog.tenantId
```

No dog is ever silently classified as `OWNER_CREATED` or `IMPORTED` by inference — those values are only ever written by an explicit, new creation path going forward. This satisfies the "do not silently misclassify records" requirement: absence of the field means "known-breeder-issued, pre-dating this ADR," never "unknown."

### 4. Owner-created dog behavior

A pet owner creates a Dog ID with no breeder organisation involved, exactly as `createDog()` already mechanically allows today:

```
tenantId        = uid()   (unchanged from current behavior)
currentOwnerId  = uid()   (unchanged from current behavior)
createdByUserId = uid()   (new)
sourceType      = 'OWNER_CREATED'   (new)
originBreederId = absent / not written   (new behavior — see below)
```

This is the smallest possible change: the write path adds two fields and, for this one branch, stops writing `originBreederId`. Nothing about `tenantId`/`currentOwnerId` semantics, the Firestore rules, or the claim/transfer APIs needs to change for this to work, because those all already key off `tenantId`/`currentOwnerId`, not `originBreederId`.

### 5. Imported dog behavior — future-ready only

`IMPORTED` is added to the enum now so the type is complete and no future migration is needed to add a third value. **No import workflow, no import-specific fields, and no import UI are built in this phase.** Any dog created today, by any path, will be `BREEDER_ISSUED` or `OWNER_CREATED` only.

### 6. Provenance language

Display copy for a dog's origin must use:

- **"Issued by [kennel/breeder name]"** — for `BREEDER_ISSUED`
- **"Created by [owner name]"** — for `OWNER_CREATED`
- **"Uploaded by [name]"** — for document-level attribution (vaccine cards, pedigree certs), independent of dog-level origin
- **"Source"** — as a neutral label where origin needs to be shown without asserting authority (e.g. QR Passport info tab)
- **"Supported by documents"** — where a dog's record includes uploaded proof, as opposed to unverified self-entry

Must **never** use "Verified by iDogs" or "iDogs verified" anywhere — iDogs does not verify identity claims, it stores what the creator entered plus whatever documents they chose to upload. This applies to all new UI copy introduced by implementation of this ADR, and should be checked against any existing copy touched during implementation (audit found no existing instances of the banned phrases in the current codebase, so this is a forward-looking constraint, not a cleanup item).

### 7. Ownership transfer — confirmed invariants

Transfer and claim (`transferDogOwnership()` in `src/lib/db.ts`, `/api/claim-transferred-dogs.js`) require **zero changes** under this ADR. Confirmed invariants, all already true of the existing `tenantId`/`currentOwnerId` split and simply extended to the new fields:

- `sourceType` never changes after transfer or claim.
- `tenantId` never changes after transfer or claim (already the case; this ADR does not touch it).
- `createdByUserId` never changes after transfer or claim (new field, same immutability contract as `tenantId`).
- `currentOwnerId` changes on claim, exactly as today.
- The Dog ID (Firestore document ID, `passportId`, and QR code) remains the same across any number of transfers.
- Breeder provenance (`sourceType: 'BREEDER_ISSUED'`, `tenantId`, `originBreederId`) remains visible to the current owner after claim, exactly as `tenantId`-derived data already is today (e.g. audit history, breeder-issued badges) — a claimed dog does not lose its "Issued by [original kennel]" label just because it changed hands.

### 8. Pedigree field decision

**Recommendation: reuse the existing `pedigreeRegister` field; do not add a new picker.**

`DogFormData.pedigreeRegister` already has exactly the right shape for this: `'main' | 'limited' | 'no_pedigree' | 'mixed' | 'rescue'`. The `no_pedigree`, `mixed`, and `rescue` values already describe non-breeder-issued dogs and already exist in `DogNewPage.tsx`'s dropdown today, with copy that already says *"iDogs will still track health records, vaccines and reminders for this dog"* for exactly those three values. This field was, without anyone naming it as such, already halfway to being the owner-created source picker.

Rather than adding a second, overlapping field, the smallest backward-compatible change is:

- Keep `pedigreeRegister` as-is, for both origins — it answers "what's this dog's registration/pedigree status," which is a legitimate, independent question from `sourceType`.
- Set `sourceType` from the **entry flow** the user chose (breeder-shaped form vs. owner-shaped form), not by inferring it from `pedigreeRegister`'s value. A breeder can legitimately create a `no_pedigree` or `rescue`-register dog (e.g. a breeder rehoming a dog without papers); that dog is still `BREEDER_ISSUED` because of who created it and in what context, not because of its pedigree status. Conflating the two would misclassify real cases.

This means implementation needs one new, explicit signal (which creation flow / which account role the user is in) — not a new form field.

### 9. Firestore / security

**Preferred outcome: no rules change.**

`sourceType` and `createdByUserId` are plain data fields on a document that is already permitted to be created under `allow create: if isSignedIn() && request.resource.data.tenantId == request.auth.uid` — adding fields to that same write does not require a new rule, because the rule's condition is unaffected by which other fields are present.

Implementation must, before shipping:
- Verify (via the Firestore Emulator, matching the pattern already used earlier in this engagement for the reminders rules fix) that an `OWNER_CREATED` dog's `create` write — with `sourceType`, `createdByUserId`, and no `originBreederId` — passes the existing `dogs` rule unchanged.
- Verify read/update access for an owner-created dog behaves identically to a breeder-issued one (it should, since access is keyed on `tenantId`/`currentOwnerId`, neither of which this ADR touches).

Rules should only be changed if this verification finds an actual block — expected outcome is that it will not. **Tenant isolation must never be weakened globally** to accommodate this feature; if any gap is found, the fix must be scoped as narrowly as the existing `reminders` get/list split was (see `firestore.rules` history this engagement), not a blanket relaxation.

> **Addendum (2026-07-14, audited against current code — no decision in this ADR changed):** the prediction above held for this ADR's own implementation — adding `sourceType`/`createdByUserId` never required a rules change. A **later, separate** security audit (dog ownership access-matrix work) subsequently hardened `dogs/{dogId}`'s `create` and `update` rules to explicitly require `tenantId`, `currentOwnerId`, `createdByUserId`, and `sourceType` stay unchanged across any client write — i.e. this ADR's immutability contract for those fields is now enforced at the rules level, not just by convention/application code. This strengthens, and does not contradict, everything decided here.

---

## Alternatives Considered

1. **Redefine `tenantId` as "current workspace" instead of permanent provenance.** Rejected — this is the single highest-risk option. `tenantId` immutability is already relied upon by the claim API, the reminders claimed-dog merge (three separate fix cycles this engagement), and the Firestore rules. Redefining it would require touching all of those simultaneously for zero product benefit, since `currentOwnerId` already correctly serves as "current workspace."
2. **Add `issuedByOrganisationId` now, in anticipation of future kennel/org accounts.** Rejected for this phase — no organisation entity exists yet (`kennelName` is a string, not a linked record), so the field would have nothing real to point to. Adding it now is speculative complexity with no consumer.
3. **Add a personal "workspace" concept for pet owners, distinct from breeder tenants.** Rejected — `tenantId` already functions as a personal workspace scope for any individual `uid` today, and every rule/query already treats it this way. A separate workspace model would be pure ceremony.
4. **Infer `sourceType` for existing dogs from `pedigreeRegister` value (e.g. `rescue`/`no_pedigree` → `OWNER_CREATED`).** Rejected — conflates "what is this dog's registration status" with "who created this record and how." A breeder can create a rescue-register dog; an owner can create a main-register dog (e.g. entering an already-pedigreed dog they received privately, not via iDogs transfer). Inferring origin from pedigree status would misclassify real cases, violating the "do not silently misclassify records" requirement.
5. **New, separate "Dog source" picker distinct from `pedigreeRegister`.** Rejected as unnecessary — `pedigreeRegister`'s existing `rescue`/`no_pedigree`/`mixed` values already cover the owner-created-dog cases the product direction describes, and the copy in `DogNewPage.tsx` already anticipates this. Adding a second, overlapping field would create two sources of truth for a similar question and confuse the creation form.

---

## Consequences

**Positive:**
- Every dog going forward is classifiable by origin without any change to ownership, transfer, or claim logic.
- Existing breeder-issued dogs require zero migration and remain fully functional and correctly classified by default.
- Owner-created dogs become a first-class, named concept instead of an unlabelled side-effect of a role-agnostic write path.
- No new Firestore rules, no new collections, no new access-control surface.

**Negative / accepted tradeoffs:**
- `createdByUserId` will be numerically identical to `tenantId` for every dog that exists under this model — it only earns its keep if a future feature needs to distinguish "who entered the data" from "the provenance anchor for ownership logic." This ADR accepts that redundancy now in exchange for a stable, unambiguous field name for anything that later needs it (e.g. co-owned accounts, an org acting on a member's behalf), rather than overloading `tenantId` further.
- `originBreederId` remains in the schema, unused by any new logic, purely for backward-read compatibility. It is not removed (removal would be a destructive migration this ADR explicitly avoids), just no longer written for `OWNER_CREATED` dogs.
- Breeder-shaped UI (Breeder ID fields, Pedigree Register-as-breeding-status, Breeding tab, litter linkage) still needs per-`sourceType` gating work in implementation — this ADR defines the data model that makes that gating possible, but does not itself change any UI.

---

## Backward Compatibility

- No existing `Dog` document requires modification for this ADR to take effect. `sourceType ?? 'BREEDER_ISSUED'` and `createdByUserId ?? tenantId` are safe read-time defaults, computed at read time in the same place `Dog` documents are already mapped from Firestore snapshots (`getDog()`, `getDogs()` in `src/lib/db.ts`), not written back.
- The `Dog` TypeScript interface (`src/types/index.ts`) gains two new **optional** fields (`sourceType?`, `createdByUserId?`) rather than required ones, so no existing document fails to type-check on read.
- `originBreederId` remains declared and populated exactly as today for all existing and all future `BREEDER_ISSUED` dogs — zero behavior change for the breeder path.

---

## Migration Strategy

**No bulk migration required or recommended.** Because absence of `sourceType` unambiguously means `BREEDER_ISSUED` (per §Decision 3), there is no urgency and no correctness reason to backfill every existing document. Options for implementation to choose from, in order of preference:

1. **Lazy backfill on next write** — when `updateDog()` is called on a legacy dog for any other reason, opportunistically set `sourceType: 'BREEDER_ISSUED'` and `createdByUserId: dog.tenantId` if absent. Zero extra writes, zero migration script, fully safe.
2. **One-time script, if Tony wants the fields visibly present in Firestore console sooner** — a simple `where sourceType == null` batch-update, safe because the target value is deterministic and non-destructive (adds fields, changes nothing else). Not required for correctness; purely cosmetic/operational preference.

Either choice is safe under this ADR; neither is a blocker to shipping the read-time default behavior first.

---

## Security Implications

- No new PII fields — `createdByUserId` is a `uid`, already exposed via `tenantId` on the same document today.
- No new public-read surface — `sourceType`/`createdByUserId` are subject to the exact same `dogs` collection read rule as every other field on the document (private, tenant/owner-scoped) unless and until the public QR Passport route (`/api/passport`, Admin-SDK-backed, already field-filtered server-side) is explicitly updated to include an origin label — which is a UI decision (§UI Implications), not a rules change.
- No change to who can create, read, update, or delete a `Dog` document — access remains fully governed by existing `tenantId`/`currentOwnerId` checks, which this ADR does not modify.
- Confirms (does not change) that tenant isolation is preserved: an owner-created dog is exactly as isolated to its creator as a breeder-created dog is to its breeder, using the identical rule.

---

## UI Implications

(Implementation detail, not built by this ADR — recorded here to scope Phase 1+ correctly.)

- `DogNewPage.tsx`: creation flow needs to determine `sourceType` from context (most likely: `profile.role === 'breeder' ? 'BREEDER_ISSUED' : 'OWNER_CREATED'`, pending resolution of the signup-role bug noted in Open Questions) and pass it to `createDog()`.
- `DogDetailPage.tsx`: display "Issued by [kennel]" / "Created by [owner]" using the language rules in §Decision 6; gate the Breeding tab and litter-linkage UI on `sourceType === 'BREEDER_ISSUED'` in addition to the existing sex check.
- `PassportPublicPage.tsx` / `/api/passport`: optional addition of a "Source" label on the public passport info tab, using the neutral language from §Decision 6 — not required for Phase 1, can follow in a later phase.
- No changes needed to Reminders, Documents, Vaccines, Timeline, or Export UI — none of those surfaces need to know a dog's origin to function correctly.

---

## Acceptance Criteria

- [ ] Existing breeder-issued dogs continue working with zero behavior change — no re-authentication, no re-classification prompt, no data loss.
- [ ] Claimed dogs preserve provenance: `sourceType` and `tenantId` are identical before and after a claim.
- [ ] A pet-owner account can create a dog with `sourceType: 'OWNER_CREATED'`, `tenantId = currentOwnerId = createdByUserId = uid()`, and no `originBreederId`.
- [ ] `sourceType` is provably stable through a full transfer + claim cycle (verify via the same QA pattern used for the claimed-dog reminder fixes this engagement: transfer a dog, claim it as a second account, confirm `sourceType` unchanged on both the transferring and claiming account's view).
- [ ] QR Passport (`/p/:passportId` → `/api/passport`) remains fully un-gated by plan or role — confirmed by this ADR's audit predecessor, must remain true after implementation.
- [ ] Dog Transfer remains fully un-gated by plan or role — same confirmation requirement.
- [ ] No destructive migration is run — no field is removed, no document is rewritten in a way that could lose data.
- [ ] Old records remain fully readable with the two new fields absent, defaulting correctly per §Decision 3.
- [ ] Firestore Emulator verification (get/list/create for an `OWNER_CREATED` dog) passes against the *existing, unmodified* `dogs` rule before implementation is considered complete.

---

## Open Questions

1. ~~**Signup role bug** — sequencing decision needed.~~ **RESOLVED (approved):** the signup role bug (`SignupPage.tsx`'s Pet Owner/Breeder selector never reaching `signup()`, so every account currently gets `role: 'breeder'`) is fixed as **Phase 0**, before any `sourceType`/`createdByUserId` work begins, since Phase 2's automatic `sourceType` assignment depends on `profile.role` being correct. See the companion Phase 1 Implementation Plan for exact files and sequencing.
2. ~~Should `sourceType` be user-selected or inferred?~~ **RESOLVED (approved): `sourceType` is assigned automatically from `profile.role` at creation time — never user-selected.** Breeder-role accounts always produce `BREEDER_ISSUED`; owner-role accounts always produce `OWNER_CREATED`. No origin picker or confirmation step is added to `DogNewPage.tsx`. Revisit only if a real case emerges where a breeder account needs to create an `OWNER_CREATED`-classified dog (e.g. a breeder personally rescuing a dog outside their kennel) — not addressed in Phase 1.
3. Timing for `issuedByOrganisationId`: confirmed out of scope for now (§Decision 2), but should this ADR's "future" language be treated as a placeholder for ADR-2 (Pet Owner Identity & Workspace Model), or does it need its own future ADR once a real organisation/kennel entity is designed? **Still open — does not block Phase 1.**

---

## Implementation Sequence

1. Add `sourceType?` and `createdByUserId?` as optional fields to the `Dog` TypeScript interface (`src/types/index.ts`). No other type changes.
2. Update `createDog()` (`src/lib/db.ts`) to write `createdByUserId: uid()` always, and `sourceType` based on the resolved role/context (pending Open Question 1's sequencing decision) — `originBreederId` continues to be written only for the `BREEDER_ISSUED` branch.
3. Update `getDog()`/`getDogs()` read-mapping to apply the `sourceType ?? 'BREEDER_ISSUED'` / `createdByUserId ?? tenantId` defaults from §Decision 3, so every caller sees a resolved value without needing to know about the fallback.
4. Firestore Emulator verification of `create`/`get`/`list` for an `OWNER_CREATED` dog against the current, unmodified rules — confirm no rule change is needed (§Security Implications).
5. Preview-only QA: create an owner-created dog, transfer it, claim it on a second account, confirm `sourceType`/`createdByUserId`/`tenantId` are unchanged throughout — mirroring the QA pattern already proven for the reminders fixes this engagement.
6. Only after 1–5 are verified on Preview: begin UI implication work (§UI Implications) as a separate, later phase — this ADR's Phase 1 is data-model-only.
