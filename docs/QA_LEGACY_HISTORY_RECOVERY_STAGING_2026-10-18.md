# Legacy history recovery — staging QA, 18 October 2026

Scope: PR #26 on `idogs-app-staging` only. No production data, rules, Storage/CORS or environment settings were changed. Account identifiers are abbreviated; the private recovery plans stay outside Git.

## Code under test

- Verified at `be6233739cbcd5e1aff99c4ea729c1e0667608a5` (PR head before this report). This report adds documentation only.
- Fix: real transfers save `dogs.transferredAt` before the `dog_transferred` audit, which is written after the buyer email (0.5–15 s later on staging). The former exact-equality check refused every legacy dog. `dogs.transferredAt` is now always the cutoff; the audit must fall within 10 minutes after it, and an earlier or distant audit is refused. Staging apply recomputes the same rule inside its transaction.

## Staging recovery

QA dog `o53A8Oyd…` ("QA-Black Boy-transfer test"), former owner `iQnWh…`, current owner `gOq7W…`.

| Step | Result |
| --- | --- |
| Dry-run | `recovered_partial`; cutoff = `dogs.transferredAt` 2026-10-14T11:17:11.809Z; audit 11:17:12.905Z; no live media/document URLs |
| Included | 1 pre-transfer timeline note and its photo (saved generation `1791976598944214`) |
| Excluded | 1 vaccine, 2 worming, 1 reminder, 1 note — all created by the current owner after transfer |
| Apply (staging) | Snapshot created 2026-10-18T12:14:12Z |
| Repeat apply | Refused: `HISTORY_ALREADY_EXISTS` |

## Authenticated browser QA

Stable branch Preview `idogs-app-git-fix-former-owner-46c18a-…vercel.app`, verified to alias deployment `dpl_CUnsGSQy…` at `be623373`; bundle references only the staging Firebase project.

| Check | Result |
| --- | --- |
| Former owner opens dog | Read-only recovered history, partial-history banner, no add/edit/delete/upload/transfer controls on any of 10 tabs |
| Recovered records | Timeline shows only the pre-transfer note; no current-owner record on any tab |
| Photo | Signed URL (5-minute expiry) with `generation=1791976598944214`, loads |
| Reload | Same history and photo |
| No token | History API 401, media API 401 |
| Current owner (no history right) | History detail 404, media 404, history list excludes the dog; sees only the live workspace |
| Current-owner update | Two QA notes added through the UI (12:27Z and 12:43Z); snapshot `updateTime`, contents and media generation byte-identical before and after |

An earlier round on the `343ab090` Preview gave the same results.

## Automated gates at `be623373`

- Vitest 108/108; recovery node tests 8/8; Firestore emulator recovery E2E PASS; `tsc && vite build` PASS.
- GitHub "Typecheck, tests, build" ×2 success; Vercel Preview `idogs-app` and `idogs-app-staging` READY.

## Not done

Production deploy, merge and the production Pink Girl backfill remain subject to separate approval.
