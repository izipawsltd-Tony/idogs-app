# ADR-002: QR Passport Public Architecture

## Status
Proposed — architecture audit only. Not yet approved. No implementation in this phase.

## Date
2026-07-14

---

## Context

ADR-001 established `sourceType`/`createdByUserId`/provenance language and explicitly deferred one item to a later phase:

> "`PassportPublicPage.tsx` / `/api/passport`: optional addition of a 'Source' label on the public passport info tab, using the neutral language from §Decision 6 — not required for Phase 1, can follow in a later phase."

This ADR is that later phase's architecture audit. **The QR Passport feature already exists and is live** — this is not a greenfield build. `/p/:passportId` (`PassportPublicPage.tsx`) and `/api/passport` (Admin-SDK-backed, field-filtered) have been functioning throughout this entire engagement, including during every phase's QA. The task is to audit whether the existing architecture safely supports the ownership/provenance model built across Phases 0–5, and scope the smallest safe next release — not to design a passport system from scratch.

---

## 1. Current Architecture Findings

- **Route:** `/p/:passportId` — public, unauthenticated, no `ProtectedRoute` wrapper (`src/components/App.tsx:62`). Correctly placed in the public route block.
- **Data path:** `PassportPublicPage.tsx` calls `GET /api/passport?passportId=...`, which uses the Firebase Admin SDK (bypasses Firestore rules entirely) to look up the dog by `passportId` (a `where()` query, not a direct doc `get()` — the Firestore document ID is never exposed to the client) and returns an **explicit field allowlist**, not the raw document.
- **QR generation:** entirely client-side, in the owner/breeder's own session (`qrcode` npm package, `QRCode.toDataURL()` in `DogDetailPage.tsx`'s `PassportTab`). No server-side QR generation exists or is needed.
- **Scan logging:** `/api/passport` writes a `scanLogs` doc server-side on every view (`allow create: if true` in `firestore.rules`, matching the public/anonymous nature of scans). Reads are explicitly denied to all clients (`allow read, update, delete: if false`) — the rule's own comment states this is deliberate, to prevent the passport becoming a "stalking/tracking leak."
- **Passport survives transfer/claim, confirmed by code inspection, not just documentation:** `transferDogOwnership()` (`src/lib/db.ts`) and the claim route (`api/claim-transferred-dogs.js`) never touch `passportId`, `sourceType`, or `createdByUserId`. The Dog ID, QR code, and passport URL are stable across any number of transfers — this already satisfies the approved ownership model's "passport survives transfer and claim" requirement with zero additional work.
- **Legacy fallback:** `sourceType`/`createdByUserId` are resolved at read time via `normalizeDog()` in `db.ts` for every caller, including (once wired) the passport API — no dog is ever unclassified.

## 2. Existing Reusable Components/Functions

- `PassportPublicPage.tsx` — full public display shell (hero header, tabs, iDogs branding, footer) — reusable as-is; only the Info tab's field list and a new provenance section need to change.
- `api/passport.js` — the field-allowlist pattern is exactly the safe shape to extend (add fields to the allowlist deliberately, one at a time) rather than replace.
- `PassportTab` (`DogDetailPage.tsx`) — private-side QR card, download/copy/preview actions — reusable unchanged.
- `qrcode` (already a dependency) — no new package needed.
- `getDogByPassportId()` (`db.ts`) — used by the *authenticated* app elsewhere; not used by the public API today (which queries Firestore directly via Admin SDK) but the same `where('passportId','==',...)` shape either way.

## 3. Security and Privacy Risks

**Confirmed already-safe:**
- No internal Firestore document ID, `tenantId`, `currentOwnerId`, or `originBreederId` is exposed today.
- `notes`, `buyerName/Email/Phone`, `reservedFor*`, `depositAmount` — all breeder/owner-only fields — are correctly absent from the API's allowlist.
- Documents (uploaded certs/scans) are **not** reachable publicly at all: viewing any document requires `POST /api/get-signed-url` with a valid Firebase ID token, which the anonymous passport page never has. This is a hard boundary, not an oversight to fix.

**New/confirmed risks found this audit:**
- **Legal copy violation, already live:** `PassportPublicPage.tsx`'s footer reads "🇦🇺 Data stored in Australia" — this directly contradicts CLAUDE.md's explicit rule ("stored securely in Asia-Pacific... NEVER mention... 'stored in Australia'"). This predates this audit and is unrelated to provenance work, but should be fixed at the first opportunity since it's a standing compliance issue, not a hypothetical one.
- **Broken, silently-defaulting scan count:** `getScanCount()` (`db.ts`) performs a direct client-side query against `scanLogs`, which `firestore.rules` denies to every client (by design). Every call site wraps this in `.catch(() => 0)`, so the breeder-facing "Total scans" figure on `PassportTab` always silently shows `0`, regardless of actual scan volume. This is the same failure shape as the reminders/documents bugs fixed earlier in this engagement (a rules-correct denial being silently swallowed into a misleading default) — not a security hole, but a real, currently-shipping data-integrity bug.
- **Passport identifier entropy:** `passportId` format is `${first-3-letters-of-name}-${birthYear}-${nanoid(4)}`, where `nanoid(4)` draws from a 32-character alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, ambiguous characters excluded) — roughly 2^20 (~1,048,576) combinations for the random suffix. The name/year prefix is guessable (common dog names, plausible birth years), which narrows an attacker's effective search space per guess. Combined with **no rate limiting on `/api/passport`** (a standard Vercel serverless function, no middleware), this is a real, low-but-nonzero enumeration/scraping risk. The currently-exposed field set is low-severity if enumerated (no PII beyond breed/DOB/microchip/ANKC), but microchip numbers are semi-sensitive (used for pet recovery/theft claims) and the risk grows with any future expansion of the public field set.
- **No collision check at write time:** `createDog()` writes `passportId` without first querying for uniqueness. `getDogByPassportId()`/`/api/passport` both use `.limit(1)`, so in the (rare) event of a collision, the second dog with that ID becomes silently unreachable via passport lookup — a real, if low-probability, correctness bug.
- **No `isDeceased`/revoked handling on the public page:** a deceased dog's passport displays identically to a living dog's — no "In Memory" treatment, no distinction. `dog.isDeceased` already exists and is used elsewhere (`lifeStage: 'remembered'`) but is never read by `PassportPublicPage.tsx` or `/api/passport`.
- **No handling for a deleted dog beyond generic 404** — acceptable (a hard-deleted dog has no data left to leak), but worth naming explicitly as the intended behavior rather than an accident.

## 4. Recommended Public-Read Architecture

**Keep the existing server-API pattern — do not attempt a direct public Firestore read.** This is already the correct, load-bearing architecture (confirmed by the rules-lockdown history recorded in `api/passport.js`'s own comment) and should not be replaced. Any new public field (provenance label, revoked-state flag) should be added to the **existing allowlist** in `api/passport.js`, the same deliberate, one-field-at-a-time pattern already in place — never by relaxing `firestore.rules` for public/anonymous access. This matches the task's explicit guardrail ("Do not broaden Firestore rules merely to make a collection-wide query pass") applied to the passport case specifically.

For the scan-count bug: **add a narrow, authenticated server endpoint** (or fold an aggregate count into an existing authenticated call) that uses the Admin SDK to read `scanLogs` on the breeder/owner's behalf — mirroring `get-signed-url.js`'s ownership-check pattern (verify `dog.tenantId === uid || dog.currentOwnerId === uid` before returning the count). Do not relax `scanLogs`' `read: false` rule — the rule's own reasoning (stalking/tracking prevention) still applies to any *other* signed-in user reading another dog's scan history, so this must be scoped per-dog and per-owner, not a blanket read grant.

## 5. Recommended Identifier and URL Design

**Recommendation: keep `passportId` as the URL identifier for now; do not introduce a second token for the MVP.** Reasoning:
- Existing `passportId`s are already deployed (printed on physical QR codes, shared as links) — changing the URL scheme for existing dogs would break already-distributed QR codes, which is a real-world "destructive migration" in effect even without touching Firestore.
- The realistic attacker value of enumerating a passport today is low (no PII beyond breed/DOB/microchip/ANKC, no financial or contact data), so the entropy weakness is a real but not urgent risk at MVP scope.
- **Do** add rate limiting to `/api/passport` (a cheap, non-breaking addition — e.g. a simple IP-based throttle) before or alongside this phase's shipped changes, since that mitigates the enumeration risk without touching the identifier format at all.
- **Do** add a uniqueness check (query-before-write, or a Firestore transaction) to `createDog()` for `passportId`, independent of any URL-design decision — this is a correctness fix, not a security-architecture one.
- **Flag for a future ADR, not this one:** if the public field set ever grows to include anything more sensitive than today's set, revisit issuing a separate high-entropy `publicToken` for the URL (decoupled from the human-readable `passportId`), so `passportId` can stay short/human-legible while the actual public URL uses a longer, unguessable value. Not needed for the MVP scope defined below.

## 6. MVP Public Field List

Additive to the current allowlist — no existing field removed:

| Field | Source | Notes |
|---|---|---|
| `name`, `breed`, `sex`, `dateOfBirth`, `colour`, `lifeStage`, `profilePhoto`, `passportId` | existing | unchanged |
| `microchip`, `ankc` | existing | **already exposed today** — ADR-001's audit flagged this as an open product decision (§Open Questions is silent on it; `api/passport.js`'s own comment calls it out as "a product decision for Izi, not something to change unilaterally here"). This ADR does not resolve it — see §Open Questions below. |
| `status` (transferred badge) | existing | unchanged |
| **`sourceType`** | new | drives the provenance label per ADR-001 §Decision 6 |
| **provenance label text** (computed server-side or client-side from `sourceType`) | new | `BREEDER_ISSUED` → "Issued by" + safe fallback; `OWNER_CREATED` → "Created by" + safe fallback; `IMPORTED` → "Source" + "Imported record". **Never a real name** — see §7 below, this is the one point where the public-page case genuinely differs from the already-shipped private-page provenance logic. |
| **`isDeceased`** | new | drives a "In Memory" / "Remembered" treatment, matching the private-side `lifeStage: 'remembered'` badge already used elsewhere |

## 7. Private/Excluded Field List (confirmed, unchanged)

Never exposed, no change recommended: `id`/Firestore doc ID (already never exposed — lookup is by `passportId` query, not doc `get()`), `tenantId`, `currentOwnerId`, `createdByUserId` (the raw uid — see below), `originBreederId`, `notes`, `buyerName`/`buyerEmail`/`buyerPhone`/`transferredAt`, `reservedForName`/`Email`/`Phone`, `depositStatus`/`depositAmount`/`depositReceivedAt`, `breederIdType`/`breederIdValue`, `microchipCertPath`/`microchipCertUrl`, all `documents`/`vaccineRecords`.`documentPath`-style storage paths, litter/breeding fields, pedigree register detail beyond what's already shown.

**Provenance name display — explicit recommendation:** unlike the already-shipped private-side provenance (`DogDetailPage.tsx`), which can show a real `kennelName`/owner name when the *viewer themselves* is the relevant party (breeder viewing their own issued dog, owner viewing their own created dog), a public passport visitor is **never** the relevant party by definition. The public passport must **always** use the generic fallback text ("Breeder-issued Dog ID" / "Current owner" / "Imported record") — **never** a real kennel or owner name, regardless of `sourceType`. This avoids inventing a new PII-exposure surface (tying a real person's name publicly to a specific dog + microchip number) and keeps the language consistent with ADR-001 §Decision 6's explicit ban on inventing/asserting identity claims publicly.

## 8. Transfer and Provenance Behavior

Already correct, confirmed by code inspection (§1): `passportId`, `sourceType`, and `createdByUserId` are untouched by `transferDogOwnership()` and the claim API. A dog transferred and claimed keeps the exact same QR code, same passport URL, and same provenance origin label throughout. The only field that should ever change the passport's *display* is `status` (already handled — the existing "Transferred" badge), which is a display-only signal, not a change to the underlying identity.

## 9. Proposed ADR Title and Decisions

**Title:** *ADR-002: QR Passport Public Provenance & Hardening* (this document, once reviewed and approved)

**Proposed decisions for approval:**
1. Extend `api/passport.js`'s allowlist with `sourceType` and `isDeceased`; compute provenance label server-side using ADR-001 §Decision 6 language, generic-fallback-only (§7).
2. Add a narrow, authenticated `scanLogs` count endpoint (or fold into an existing call) to fix the silently-broken scan count — no `firestore.rules` change.
3. Add a `passportId` uniqueness check to `createDog()`.
4. Add basic rate limiting to `/api/passport` (implementation detail, not architecture).
5. Fix the "stored in Australia" footer text to match CLAUDE.md's Asia-Pacific rule (unrelated bug, opportunistic fix).
6. Explicitly defer: documents, buyer/deposit data, breeder ID values, and any second high-entropy public token — all out of MVP scope.

## 10. Implementation Phases

**Phase A (data/API only, mirrors ADR-001's own sequencing discipline):**
1. Add `sourceType`, `isDeceased` to `api/passport.js`'s allowlist; compute provenance label server-side (keeps the "never a real name" rule enforced in one place, not duplicated across client code).
2. Firestore Emulator / direct verification that no rule change is needed (expected: none, since this only touches the Admin-SDK-backed API, not client Firestore access).
3. Fix the footer legal-copy bug (independent, trivial, high-value).

**Phase B (public UI):**
4. `PassportPublicPage.tsx`: add provenance row to Info tab; add deceased/"Remembered" treatment.
5. Preview QA: verify a breeder-issued, owner-created, and (if a test case exists) transferred dog all show correct, generic-only provenance; verify a deceased dog's passport reflects that state; verify transfer/claim leaves the passport URL and QR unchanged.

**Phase C (hardening, can ship independently of A/B):**
6. `createDog()` passport ID uniqueness check.
7. Rate limiting on `/api/passport`.
8. Authenticated scan-count endpoint, wired into `PassportTab`'s existing "Total scans" row.

## 11. Open Questions Requiring Tony Decision

1. **Microchip and ANKC registration number on the public passport** — already live today, not introduced by this ADR, but worth an explicit decision now that provenance is being added: keep exposing them, or gate them behind some form of consent/visibility toggle? `api/passport.js`'s own comment already flagged this as unresolved.
2. **Deceased-dog passport treatment** — should a deceased dog's passport still be scannable/public at all, or should it show a distinct "In Memory" page with reduced fields (e.g. drop vaccine/health tabs, keep only identity + provenance)? This ADR recommends *keep it public with a "Remembered" badge* as the minimal change, but this is a product/tone decision, not a technical one.
3. **Rate limiting approach** — Vercel Edge Config / KV, a third-party service, or a simple in-memory per-instance throttle (weaker but zero-dependency)? Depends on budget/infra preference.
4. **Timing relative to `issuedByOrganisationId`** — ADR-001's Open Question 3 (kennel/org entity) is still unresolved; if a real organisation entity is designed later, the "Issued by" public label may need to change from a generic string to a linked, possibly-public business name. Not a blocker for this ADR's MVP scope, but worth flagging so Phase B's provenance-label implementation doesn't need a second migration later.

## 12. Exact Files Inspected

`src/types/index.ts`, `src/pages/PassportPublicPage.tsx`, `api/passport.js`, `api/get-signed-url.js`, `api/upload-document.js` (referenced, prior phase), `api/claim-transferred-dogs.js` (referenced, prior phase), `src/lib/db.ts` (`createDog`, `getDog`, `getDogs`, `getDogByPassportId`, `getScanCount`, `transferDogOwnership`, `normalizeDog`), `src/lib/utils.ts` (`nanoid`, `CHARS`), `src/pages/DogDetailPage.tsx` (`PassportTab`), `src/components/App.tsx` (route table), `firestore.rules` (`scanLogs`, `reminders` for pattern reference), `package.json` (`qrcode` dependency), `docs/ADR/ADR-001-dog-origin-and-provenance.md`, `CLAUDE.md` (legal copy rule).

## 13. Confirmation of No Code/Deploy Changes

This phase made zero application code changes, zero Firestore rules changes, and no deployment. Only this ADR document was added.
