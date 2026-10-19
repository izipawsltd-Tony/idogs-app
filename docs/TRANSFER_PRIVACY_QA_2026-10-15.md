# Transfer privacy QA — 15 October 2026

## Scope and verified environment

- Repository: `izipawsltd-Tony/idogs-app`, branch `fix/transfer-owner-privacy`.
- Firebase: `idogs-app-staging` only. No production deployment or merge.
- The generic staging alias was serving `1b093179ff9249c3f38a34d0b84c22cfcf9e0184`, not the previously cited privacy Preview `99e8e8115330b0da36638aa41f53695b0073b9ec`.
- The temporary postbuild Rules deployment hook remains removed.

## Changes

- Former-owner details use a transfer snapshot, never live child collections. Pending transfers also select history instead of rendering the live dog.
- Transfers made before snapshot capture show only the requesting account's own pre-transfer audit activity, with an explicit missing-full-history notice. These are NOT reconstructed clinical snapshots.
- Reminder queries use currently owned dog IDs. Stale reminder tenantId cannot authorize former-owner creates, updates or deletes; the current owner can complete inherited reminders. Reminder dogId cannot be retargeted by an update.
- Missing-test filters and Insights avoid clinical queries on transferred dogs.
- Historical views have no scan controls or link into a current owner's live Passport.
- Dog, breeding and litter exports independently authorize current ownership or use saved snapshots. A missing snapshot fails closed. Kennel reports contain currently owned dogs, including claimed dogs, and exclude live transferred dogs.

## Validation

| Check | Result | Boundary |
|---|---|---|
| Vitest | 86 tests passed | Actual db.ts loaders with mocked I/O plus existing suite |
| Legacy history helper | 4 tests passed | Two dogs, owner scope, transfer cutoff, missing metadata |
| History API | 6 scenarios passed | Verified identity scope, snapshots, legacy fallback, no live reads; auth SDK stubbed |
| Historical document signing | 6 scenarios passed | Exact snapshot path membership; Storage and auth SDKs stubbed |
| H8 Rules | 30 checks passed | Real Firebase Auth/Firestore emulators, actual firestore.rules |
| Transfer/claim/history/export integration | 54 checks passed | Real Firestore transactions and handlers; token verifier stubbed; demo emulator only |
| TypeScript/Vite build | Passed | Existing bundle-size warnings remain |
| Staging UI on fee7ca940aa9e5c61d44705ed9810a390528e7a9 | Passed for observed flows | Both reported dogs open their read-only audit history; 16 active dogs, 12 transferred entries, 27 documents; Reminders and Insights load |

The emulator tests create two synthetic dogs, freeze health/documents/notes/reminders/heat cycles/photos/scan count, run the actual claim handler, then add backdated entries and edit old live entries. Former-owner history and exports retain the original snapshot, while the buyer retains live access. Stranger and spoofed-tenant requests fail.

The expanded reminder test first reproduced 4 failures against the previous Rules (former-owner create/update/delete allowed; inherited completion denied). All 30 checks passed after the correction.

## Active staging Rules verification

- Applied from `fee7ca940aa9e5c61d44705ed9810a390528e7a9` in an isolated worktree.
- Rules file SHA-256 (LF bytes): `3e68061f8ff39125dcf7102871b33ce255eaffec567955820488ccb81a53bee0`.
- Active release: `projects/idogs-app-staging/rulesets/d36b5d6e-1aab-4f4a-852d-f07f419e5dff`.
- Active and expected normalized-content SHA-256 both `a2ab0fee6862f03efbc41e043a4a2edbc6158ec4fb454c5a78e4af101f1a70ca`.
- Read-only Rules Management API verification returned `matches: true`.

## Material limitation

The two reported transfers predate saved snapshots. Their complete pre-transfer health/document/media/breeding state is not recoverable from the account's audit entries alone. Opening these two transfer records is verified; restoration of their complete old clinical records is NOT passed or claimed. No current-owner data is substituted to fill that gap. Full browser E2E of a newly created snapshot transfer has not been run on staging; the complete new-transfer lifecycle above was tested in the emulator.

Production remains an independent owner approval gate.
