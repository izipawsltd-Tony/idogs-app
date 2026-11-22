# QA-SYNTH staging fixtures — LP-11 authenticated E2E

Owner gate 22 Nov 2026: "GO cho Authenticated E2E; NO-GO production". Staging-only synthetic QA.

## Isolation rules
- Project: **`idogs-app-staging` only**. The spec refuses to sign in unless the Preview bundle's Firebase `projectId` is `idogs-app-staging`, and the workflow only tests `https://idogs-app-staging-*.vercel.app`.
- Staging holds a **copy of production records with real users**. QA uses only the two new accounts below; never sign in as, read, list, or modify any copied account.
- No service account, Admin SDK script, rules change, bulk read or cleanup sweep. Fixtures are created through the normal staging app UI, exactly like a real user.

## Owner setup (one-off, about 10 minutes) — staging Preview only
Use the current RC staging Preview (for example the `ad6f962` Preview). Never use idogs.com.au.

| Step | Account A — Pet owner | Account B — Breeder |
|---|---|---|
| 1. Sign up at `<Preview>/signup` | Role **Pet owner**. Email: an inbox you control with plus-addressing, e.g. `<you>+idogs-qa-a@<domain>` | Role **Breeder**. `<you>+idogs-qa-b@<domain>` |
| | First/last name `QA-SYNTH` / `Owner`, state SA, no real phone/address | `QA-SYNTH` / `Breeder`, state SA, no breeder number |
| | Password: long random, from a password manager | different long random password |
| 2. Verify email | Click the link in the inbox (signed-URL tests require a verified email) | same |
| 3. Add one dog | Name **`QA-SYNTH A Dog`**, any breed, microchip `900000000000001` | Name **`QA-SYNTH B Dog`**, any breed, microchip **`900000000000002`**, notes **`QA-SYNTH-PRIVATE-NOTE-B`** |
| 4. Optional | — | Add one vaccine record to the B dog (so the QR Vaccines tab has data) |

Then in GitHub → repo **Settings → Secrets and variables → Actions → New repository secret** (Owner/admin only):
`E2E_STAGING_EMAIL`, `E2E_STAGING_PASSWORD` (account A) and `E2E_STAGING_EMAIL_2`, `E2E_STAGING_PASSWORD_2` (account B).
Never paste credentials in issues, PRs, chat or commit messages. If Codex runs these tests outside GitHub Actions, give it the credentials only through its own secret store.

Cost: none (staging free tier; one small PNG per account per run, deleted at the end of the run).

## What the spec checks (`e2e/auth-isolation-staging.spec.ts`)
1. A (pet owner) and B (breeder) both sign in.
2. Each dog list shows only its own `QA-SYNTH` dog.
3. Owned Documents per account: upload a stamped PNG, View (signed URL 200), Edit (rename persists after reload), Delete in `finally`.
4. **Mutual** isolation, A→B and B→A: the other account's document is not listed; opening the other account's dog URL does not show that dog; a signed-URL request for the other account's file with a valid token of the wrong account → **403** (no signed URL in the body), with no token → **401**, with a malformed token → **401**.
5. Anonymous QR passport for B's dog: API response has only `dog`, `vaccines` and `healthTests`, and the `dog` fields are within the public allowlist; the API and the rendered `/p/<id>` page never contain B's private values.

### Harness safety (Codex preflight #7075190263)
- Every browser context and request client is created with the exact configured Preview `baseURL` and the Vercel protection headers. The base URL must match `https://idogs-app-staging-*.vercel.app` (a `127.0.0.1` URL is accepted only with `E2E_HARNESS_DRYRUN=1`, for a local harness dry run). Sign-in also refuses unless the bundle's Firebase projectId is `idogs-app-staging`.
- Tracing, screenshots and video are off for this file. Credentials are entered via `evaluate()`, so their values are not recorded in step titles. Assertions on tokens, signed URLs and file paths are boolean, so failure messages never print them. Nothing is logged.
- Remaining artifact content: on failure, Playwright's error context may include an accessibility snapshot of the synthetic page (synthetic names and, if shown on screen, the synthetic account email). Report artifacts are repo-private with 14-day retention.

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
- To retire the fixtures: sign in to each account on the staging Preview, delete the `QA-SYNTH` dog, then delete the two users in Firebase console → **`idogs-app-staging`** → Authentication (check the project name first). Remove the four GitHub secrets.
- Nothing here touches production `idogs-app`.
