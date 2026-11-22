# QA-SYNTH staging fixtures — LP-11 authenticated E2E

Owner gate 22 Nov 2026: "GO cho Authenticated E2E; NO-GO production". Staging-only synthetic QA.

## Isolation rules
- Project: **`idogs-app-staging` only**. The spec refuses to sign in unless the Preview bundle's Firebase `projectId` is `idogs-app-staging`, and the workflow only tests `https://idogs-app-staging-*.vercel.app`.
- Staging holds a **copy of production records with real users**. QA uses only the two new accounts below; never sign in as, read, list, or modify any copied account.
- No service account, Admin SDK script, rules change, bulk read or cleanup sweep. Fixtures are created through the normal staging app UI, exactly like a real user.

## Accounts (done 22 Nov)
A (Pet owner) and B (Breeder) were registered through the staging Preview UI with Owner-authorised `+qa2211` plus-addresses and verified. Their credentials live only in the four encrypted repo Actions secrets `E2E_STAGING_EMAIL`/`_PASSWORD` (A) and `E2E_STAGING_EMAIL_2`/`_PASSWORD_2` (B). Never paste credentials in issues, PRs, chat or commit messages.

## Fixture dogs: automatic, UI-only, opt-in (Release Control #7078332561)
`e2e/support/qaFixtures.ts` provisions each account's single fixture dog **through the normal Add Dog form, signed in as that QA user**. No Firebase Admin, service account, rules change or collection scan.

| Account | Dog name | Microchip | Notes | Pedigree |
|---|---|---|---|---|
| A | `QA-SYNTH A Dog` | `900000000000001` | `QA-SYNTH-PRIVATE-NOTE-A` | mixed |
| B | `QA-SYNTH B Dog` | `900000000000002` | `QA-SYNTH-PRIVATE-NOTE-B` | no pedigree |

Both use breed Labrador Retriever and date of birth 2024-01-15.

**Guards before any write:** BASE_URL is an `idogs-app-staging-*.vercel.app` Preview; the bundle's Firebase projectId is `idogs-app-staging`; the account email is an authorised `+qa…@` alias; the sign-in did not land on `/verify-email`; the dog list really loaded (not the loading-error state); and **every existing dog in the account is `QA-SYNTH`**, otherwise it refuses.

**Idempotent:** creates the dog only if that exact name is missing. Never edits or deletes a dog.

**Opt-in:** the Preview workflow runs automatically on every staging deployment, so provisioning only writes when the repo **Actions variable** `E2E_PROVISION_QA_FIXTURES=1` is set (Settings → Secrets and variables → Actions → Variables). Unset: read-only; if a fixture dog is missing, the dependent tests SKIP with that reason. Intended order: Codex reviews → set the variable → rerun the Preview E2E job → unset it.

**Local proof:** `e2e/local/dog-new-fixture-form.spec.ts` runs the exact `createFixtureDogViaForm` helper against the REAL `DogNewPage` with stubbed Firebase modules, across the 6 local viewports. It checks the `createDog()` payload (name, microchip, notes, DOB, pedigree, breed set), that nothing else is written, and the post-create navigation.

Each run's documents are created and deleted by the specs themselves.

## What the spec checks (`e2e/auth-isolation-staging.spec.ts`)
1. A (pet owner) and B (breeder) both sign in.
2. Each dog list shows only its own `QA-SYNTH` dog.
3. Owned Documents per account: upload a stamped PNG, View (signed URL 200), Edit (rename persists after reload), Delete in `finally`.
4. **Mutual** isolation, A→B and B→A: the other account's document is not listed; opening the other account's dog URL does not show that dog; a signed-URL request for the other account's file with a valid token of the wrong account → **403** (no signed URL in the body), with no token → **401**, with a malformed token → **401**.
5. Anonymous QR passport for B's dog: API response has only `dog`, `vaccines` and `healthTests`, and the `dog` fields are within the public allowlist; the API and the rendered `/p/<id>` page never contain B's private values.

### Harness safety (Codex #7075190263, #7077157877)
- **Origin-bound Preview access:** the Vercel bypass secret is never a context-wide header. It is sent once, in one non-redirecting request to the exact Preview origin, to obtain Vercel's host-only bypass cookie; the browser then sends that cookie only to the Preview host. LP-11 contexts do this via `createPreviewContext`; the `page`/`context` fixtures of the other Preview specs get the same cookie from `e2e/support/global-setup.ts` (state file in the OS temp dir, never uploaded). `e2e/preview-context-sentinel.spec.ts` proves it with a dummy sentinel on two local origins: present on the Preview origin, absent from third-party subresources, fetch, off-origin redirects (page and request client), popups (signed-URL stand-in) and direct requests. Negative control: with the old context-wide header the same test fails.
- **Staging lock:** BASE_URL must match `https://idogs-app-staging-*.vercel.app` (global setup and LP-11 spec), and sign-in refuses unless the bundle's Firebase projectId is `idogs-app-staging`. The local dry-run escape hatch was removed.
- **Redaction:** traces are off for all Preview specs (they record request headers and typed values). Credentials are entered via `enterSecretly()` in all three signed-in specs, so values never appear in step titles. LP-11 assertions on tokens, signed URLs and storage paths are boolean, so failure messages never print them. Nothing is logged.
- **Residual:** failure screenshots (non-LP-11 specs) and Playwright's error context can show the synthetic page, e.g. the synthetic account email if a login fails. No password, token, bypass value or signed URL is rendered on screen. Report artifacts are repo-private with 14-day retention.

### QR public / private field matrix (from `api/passport.js`, ADR-002 Phase A)
| Public (allowlist) | Private (must never appear) |
|---|---|
| name, breed, sex, dateOfBirth, colour, lifeStage, profilePhoto, passportId, status, sourceType, isDeceased | microchip (`900000000000002`), ankc/pedigree registration, notes (`QA-SYNTH-PRIVATE-NOTE-B`), tenantId, currentOwnerId, createdByUserId, originBreederId, buyer fields, breeder ID, photos/videos storage paths, documents, owner email |
| vaccines: name, dateGiven, nextDue, vetClinic, uncertain | — |
| healthTests: testType, result, dateTested, lab, certNumber | — |

## Redacted fixture identifiers
After setup, post in #103 only: the account roles, the dog names above, the dog IDs and B's Passport ID (not secret: the QR is public by design). Never post email addresses with passwords, ID tokens or signed URLs.

## Cleanup / rollback
- Per run: the spec deletes the documents it created. If a run is interrupted, delete any `QA-SYNTH … doc …` document from the account's Documents page.
- To retire the fixtures: unset `E2E_PROVISION_QA_FIXTURES`, sign in to each account on the staging Preview, delete the `QA-SYNTH` dog, then delete the two users in Firebase console → **`idogs-app-staging`** → Authentication (check the project name first). Remove the four GitHub secrets.
- Nothing here touches production `idogs-app`.
