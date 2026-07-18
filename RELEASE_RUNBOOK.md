# Release Runbook — Litter / Heat Cycle / Puppy server-side rewrite

Covers the release that moves litter create/update/delete, heat cycle
create/update, and puppy creation onto trusted server endpoints, with
firestore.rules denying the equivalent direct client writes (Codex
rounds 3–5 remediation, `fix/sire-heat-cycle` branch). Use this runbook
for THIS release; treat it as a template for any future release that
pairs new server endpoints with newly-restrictive Firestore Rules — the
ordering problem (client+APIs before Rules on the way up, Rules before
Vercel on the way down, Steps 2–5 below) is general, not specific to
this one change.

This document does not deploy anything by itself and stores no secrets —
every command below is meant to be run manually, by a human, watching
the output at each step.

---

## 0. Before you start

- Confirm you're on the intended branch and it's the commit you mean to
  ship: `git status` (must be clean) and `git log --oneline -1`.
- Confirm `npm run build` passes locally (this also runs `tsc`) — do not
  proceed past this point if it doesn't.
- Read `CLAUDE.md`'s "Vercel env vars" note before touching anything —
  Preview and Production have SEPARATE `FIREBASE_*` values, and this
  runbook never asks you to view or copy either.

---

## 1. Preflight — required server env vars (names only, never values)

Every new/changed endpoint in this release (`api/create-litter.js`,
`api/save-heat-cycle.js`, `api/create-litter-puppy.js`,
`api/update-litter.js`, `api/delete-litter.js`,
`api/remove-litter-puppy.js`) uses the Admin SDK and requires exactly
these three environment variables to already be set in the target Vercel
environment (Preview or Production — each has its own values, see
`CLAUDE.md`):

```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Run the preflight script against the environment you're about to
release to. It checks NAMES ONLY — it never prints a value, and it
refuses to run anywhere that isn't explicitly `preview` or `production`:

```powershell
node scripts/preflight-release-check.mjs preview
node scripts/preflight-release-check.mjs production
```

**Stop condition:** if either check reports a missing variable, stop —
do not deploy. Set the missing variable in Vercel → Settings →
Environment Variables (scoped correctly — Preview vars must NOT be
copied into Production, see `CLAUDE.md`), then re-run the check.

---

## 2. Deploy new APIs + client FIRST (before tightening Rules)

```powershell
npm run build
vercel deploy            # Preview — safe default, uses idogs-app-staging
```

Why this order, specifically: the new client bundle (`src/lib/db.ts`,
`src/pages/LittersPage.tsx`, `src/pages/DogDetailPage.tsx`) no longer
attempts any of the direct Firestore writes the new Rules are about to
deny — it calls the new API endpoints instead. That means the new client
works correctly against the OLD (still-permissive) Rules, because it
simply never exercises the paths the old Rules used to allow. Deploying
Rules first would do the opposite: the OLD client bundle, still live for
anyone with an open tab or a cached page, would start getting
`PERMISSION_DENIED` on writes it used to be able to make, with no new
client code yet live to have replaced those calls with API requests.
**Server code and client code always go out together and always go out
before Rules.**

**Stop condition:** if `npm run build` fails, or the Preview deploy
fails, stop. Do not proceed to Step 3 with a half-deployed client.

---

## 3. Verify the new APIs work correctly under the OLD (still-live) Rules

Against the Preview URL from Step 2, confirm the FUNCTIONAL behavior of
the new endpoints only — do NOT check whether any raw/direct Firestore
write is denied yet (see the note at the end of this step for why).
Staging Firebase project `idogs-app-staging`, per `CLAUDE.md` — never
test against production data:

- [ ] Create a litter with a valid Dam → succeeds, litter appears.
- [ ] Create a litter with an underage/transferred/wrong-sex Dam →
      rejected with a specific reason (not a generic 500).
- [ ] Add a puppy to a litter → succeeds, QR passport created.
- [ ] Click "Add & create passport" twice quickly (or reload mid-request
      and retry) → puppy is created exactly once, no duplicate.
- [ ] Edit a litter's actual birth date → still-owned puppies' DOBs
      update; a transferred puppy's DOB does not change.
- [ ] Remove a puppy from a litter (unlink, not delete) → puppy stays in
      "My Dogs", litter's puppy count drops, and the puppy no longer
      shows as linked to that litter (two-sided membership cleared).
- [ ] Delete a litter with puppies still in your care → litter and those
      puppies are gone; a transferred/claimed puppy from the same litter
      survives AND the litter record itself is preserved (archived, not
      hard-deleted) if any such puppy is still linked.
- [ ] Record a Heat Cycle for an eligible Dam → succeeds.
- [ ] Edit an existing Heat Cycle record for a Dam who is STILL an
      eligible breeding parent → succeeds. **Known behavior change
      (Codex round 5, Blocker 5):** editing a Heat Cycle record for a Dam
      who is no longer eligible (transferred, deceased, underage) is now
      REJECTED, not just access-checked — if this staging account has
      such a record, confirm the rejection is a specific, understandable
      error, not a generic 500.
- [ ] Submit malformed input to each endpoint (an unknown field, a
      non-existent date like `2026-02-30`, a future `actualBirthDate`) →
      each rejected with a specific 400, not a 500.

**Why raw-write-denial is NOT checked here:** the OLD Rules are still
live at this point in the sequence — a raw client write to `litters/{id}`
or `heatCycles/{id}` may still be ALLOWED by them (that's expected and
correct; Step 4 is what changes it). Checking for denial before Step 4
would either fail (if the old rules still permit it, which they may) or
prove nothing meaningful either way. Verifying denial belongs strictly
AFTER the new Rules are live — see Step 4b below. Do not require
raw-write denial as a stop condition at this step.

**Stop condition:** any checkbox above fails → fix and restart from
Step 2. Do not proceed to Step 4 with a failing functional smoke test —
Step 4 removes the Rules-level safety net for the OLD code paths, and if
the NEW code has a bug, you want the OLD (permissive) Rules still
available as a fallback while you fix it.

---

## 4. Deploy restrictive Firestore Rules

Only after Step 3 is fully green:

```powershell
firebase deploy --only firestore:rules --project idogs-app-staging
```

**Stop condition:** deploy command fails → stop, do not proceed.

---

## 4b. Verify raw litter/Heat Cycle writes are now denied

Only now — with the NEW Rules actually live — confirm it. Two ways,
listed in preference order:

**Preferred (non-mutating, no real data touched):**

Auth setup (once per shell session — see "Auth for
`verify-rules-release.mjs`" below for full detail): set the SAME three
env vars Step 1 already covers, scoped to the project you're verifying
(staging vars for `idogs-app-staging`, production vars for `idogs-app`
— never mix the two):

```powershell
$env:FIREBASE_PROJECT_ID = "idogs-app-staging"
$env:FIREBASE_CLIENT_EMAIL = "<the staging service account client_email>"
$env:FIREBASE_PRIVATE_KEY = "<the staging service account private_key, one line, literal \n>"
node scripts/verify-rules-release.mjs idogs-app-staging firestore.rules
```

This reads the ACTUAL deployed ruleset via the Firebase Rules Management
REST API and diffs it against the local file — confirms the exact rules
text that denies these paths is genuinely live, without attempting any
write at all. See Step 8's own note on why this replaced the previous
"attempt a write and see if it's denied" approach.

**Optional additional confidence (functional, devtools):** if you want
to see the actual denial behavior firsthand, use ONLY a disposable test
litter/dog you created for this specific QA pass (e.g. from Step 3's own
checklist) — never a real breeder's existing record. Open browser
devtools console against the Preview URL and attempt:

- [ ] A direct client write (`updateDoc`/`deleteDoc`/`setDoc` via the
      Firebase JS SDK console) to YOUR test `litters/{id}` (create,
      update, AND delete) → all denied.
- [ ] The same to a test `heatCycles/{id}` (create AND update) → all denied.
- [ ] A direct client write to your test litter's `puppyIds` specifically
      (the exact bypass Codex round 4/5 named) → denied.
- [ ] A direct client delete of a test Dog carrying ANY of
      buyerEmail/previousOwnerId/transferredAt/claimedAt/claimedBy →
      denied, even if `currentOwnerId`/`status` look otherwise "clean".

**Stop condition:** the script reports MISMATCH, or any devtools attempt
SUCCEEDS (i.e. Rules did not actually deny it) → the deploy did not take
effect as intended. Do not proceed — treat this as a failed Rules deploy
and go to Step 8 (Rollback) immediately.

---

### Auth for `verify-rules-release.mjs` (Codex round 7, Blocker 2)

`scripts/verify-rules-release.mjs` calls the Firebase Rules Management
REST API directly (GET requests only — see the script's own header
comment). It authenticates with the **exact same service-account
credential every trusted API endpoint in this project already uses**
(`api/create-litter.js`, `api/delete-litter.js`, etc.) — there is no
separate tool to install and no new credential type to set up.

**What it does NOT use, and why:** earlier drafts of this script shelled
out to `npx firebase-tools login:print-access-token`. That command is
gone. It was an unpinned, undocumented CLI subcommand — `npx` resolves
whatever version of `firebase-tools` happens to be latest/cached at run
time, with no version pin and no stated support guarantee for that
specific subcommand. It has been fully removed; do not reintroduce it.

**Setup (one-time per shell session, per project):**

1. Set the same three env vars Step 1 already documents, scoped to the
   **project you're about to verify** — never mix staging and
   production credentials:
   ```powershell
   $env:FIREBASE_PROJECT_ID = "idogs-app-staging"      # or idogs-app
   $env:FIREBASE_CLIENT_EMAIL = "<service account client_email>"
   $env:FIREBASE_PRIVATE_KEY = "<service account private_key>"   # one line, literal \n — same format Vercel already stores
   ```
   Pull these values from the same place Vercel's `FIREBASE_*` env vars
   already come from (Firebase Console → Project Settings → Service
   Accounts → Generate new private key, or the existing key already in
   use for that project's Vercel env — do not generate a new key if an
   existing one already works, to avoid key sprawl).
2. Run the script (see the exact command in Step 4b or Step 8 above).

**Preflight behavior:** the script checks that all three env vars are
present BEFORE attempting any network call, and fails closed with a
message naming which variable(s) are missing (never printing any
value) if not. If `FIREBASE_PROJECT_ID` doesn't match the `projectId`
argument you passed on the command line, it prints a WARNING before
proceeding (a service account scoped to one project will normally lack
access to another project's Rules, so this situation will typically
still fail closed at the API-call step — the warning just makes the
likely cause obvious immediately instead of only from a permission-denied
error).

**Token handling:** the access token is held only in memory for the
duration of the script's process and is used solely as a `Bearer` header
on the two read-only GET requests. It is never printed, logged, written
to a file, or committed anywhere.

**Failure modes, all fail closed (never a false "verified"):** missing
env vars, a credential the Firebase Admin SDK rejects (bad/expired key,
disabled service account), a Rules Management API call that returns a
non-2xx status (e.g. permission denied because the service account
lacks access to that project, or the project doesn't exist), or a
response whose own resource name doesn't match the requested
`projectId`. Every one of these exits non-zero with a specific message
— see `scripts/test-verify-rules-release.mjs` for the full set of
mocked failure-mode tests.

---

## 5. Combined smoke QA (client + APIs + new Rules together)

Re-run the FULL Step 3 functional checklist again, this time against the
Preview URL with the NEW Rules live. This second pass exists to confirm
nothing else in the app regressed now that the stricter Rules are
actually enforcing (e.g. dogs.delete's history-field checks affecting an
unrelated feature like DogDetailPage's own "Delete dog" button).

**Stop condition:** any regression → **rollback immediately** (Step 8),
do not attempt a forward-fix under live traffic.

---

## 6. Promote to production (only after explicit approval)

Per `CLAUDE.md`: **production deployment requires explicit Tony
approval — do not run these commands without it.**

```powershell
npm run build
vercel deploy --prod                                          # after approval only
firebase deploy --only firestore:rules --project idogs-app     # after approval only, AFTER the line above
```

Same ordering rule applies at the production boundary: client/API
before Rules, never the reverse.

---

## 7. Already-open old SPA sessions

Vite ships a content-hashed bundle — a browser tab left open across a
deploy keeps running the OLD JavaScript already loaded into memory until
the user navigates in a way that re-fetches `index.html`, or does a hard
refresh. Between Step 4 (Rules tightened) and whenever each such
session naturally refreshes, that OLD tab's attempts at the now-removed
direct Firestore writes (litters update/delete, heatCycles create/
update) will start failing with `PERMISSION_DENIED` instead of the
friendlier, specific error messages the NEW API endpoints return.

Mitigations for this release:

- **Bounded exposure by design**: every write this release affects
  (litter management, heat cycles, puppy creation) is a deliberate,
  infrequent breeder action — not a background/automatic write a user
  wouldn't notice failing. A user hitting this mid-action sees a failed
  save and can simply refresh and retry, same as any other transient
  error the app already surfaces via `toast(...)`.
- **Give it time**: prefer deploying Step 4 at a low-traffic time and
  waiting a short interval (15–30 minutes is reasonable at this app's
  current traffic) after Step 2's client deploy before running Step 4's
  Rules deploy, so most active sessions have naturally refreshed (new
  page load, tab reopened, etc.) before Rules tighten.
- **No forced-refresh mechanism exists yet.** This app has no
  version-check/"a new version is available, please refresh" banner.
  Building one is out of scope for this release but is the correct
  long-term fix for this class of risk — flagged here as a follow-up,
  not solved by this runbook.
- If a support report during the deploy window matches this exact
  symptom (a litter/heat-cycle save that previously worked now fails
  with a permission error), the standard response is "please refresh
  the page and try again" — the new Rules and new client are already
  mutually consistent, only the stale in-memory bundle is not.

---

## 8. Rollback — Rules BEFORE Vercel, always, and VERIFY the rollback took effect

If anything goes wrong after Step 4/6, roll back in the OPPOSITE order
of how you deployed — Rules first, then Vercel. Codex round 5, Blocker
8: the old version of this step extracted the previous rules to a
SEPARATE file (`firestore.rules.rollback`) and then ran `firebase deploy
--only firestore:rules` — but that command always deploys whatever
`firebase.json`'s `"rules"` entry points at (`firestore.rules` itself),
so the old instructions silently redeployed the CURRENT (bad) rules
again, never the rollback content. Use the checked-in script instead —
it fixes the ACTUAL file `firebase.json` points at, and refuses to run
if `firebase.json` doesn't point where it expects:

```powershell
# 1. Roll back Rules FIRST — overwrites firestore.rules itself (with an
#    automatic timestamped backup of the current content first)
node scripts/rollback-firestore-rules.mjs <previous-good-commit>
git diff firestore.rules                 # review before deploying
firebase deploy --only firestore:rules --project idogs-app-staging   # or idogs-app for production, after approval

# 2. VERIFY the rollback is actually active — do NOT proceed to the
#    Vercel rollback on the strength of the deploy command alone.
#    Requires FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY
#    set for the project you're rolling back (see "Auth for
#    verify-rules-release.mjs" under Step 4b above) — set BEFORE running this.
node scripts/verify-rules-release.mjs idogs-app-staging firestore.rules
#    (idogs-app for production, matching whichever --project you deployed to)
#      - MATCH (exit 0)    -> rollback confirmed active, proceed to step 3.
#      - MISMATCH (exit 1) -> deploy hasn't propagated yet (allow up to
#        ~60s and re-run) or failed outright — do NOT proceed to the
#        Vercel rollback until this resolves; a Vercel rollback while
#        the NEW (restrictive) Rules are still actually live recreates
#        exactly the mismatch this ordering exists to avoid (see "Why
#        Rules first" below).

# 3. Roll back Vercel THIRD, only once step 2 confirms the Rules
#    rollback is genuinely live
vercel rollback                          # rolls the alias back to the previous deployment
# or: vercel deploy --prod (after approval) from a checkout of the previous commit
```

**Why this verification method (Codex round 6, Blocker 6):** the
previous version of this step said to verify rollback by attempting a
direct write against a REAL litter document and observing whether it
succeeded or failed — i.e. touching actual business data specifically
during an incident, when the deployed Rules' real effect is least well
understood, and creating its own cleanup burden if the "test" write
unexpectedly succeeded. `scripts/verify-rules-release.mjs` instead reads
the ACTUAL deployed ruleset's content via the Firebase Rules Management
REST API (GET requests only — never writes, never touches any
collection or document, never reads any business data at all) and diffs
it against the local `firestore.rules` file. It also independently
asserts the API response's own resource name matches the exact
`projectId` you asked about before trusting anything in it — a
response that doesn't clearly identify the right project fails loudly
rather than silently reporting a false match, so this can never be
pointed at the wrong Firebase project without erroring out first.

**Why Rules first:** the previous (pre-release) client bundle expects
the OLD, more permissive Rules — it still does direct Firestore writes
for litters/heatCycles that the NEW Rules deny. If you roll back Vercel
first while the NEW (restrictive) Rules are still live, the OLD client
you just restored will immediately start failing on writes it expects
to succeed — the exact same class of mismatch Step 7 describes, just in
the reverse direction. Rolling back Rules first (and VERIFYING it before
touching Vercel) restores the permissive baseline the OLD client
actually needs, THEN restoring the OLD client is safe.

**Stop condition / escalation:** if rolling back Rules alone doesn't
resolve the issue (e.g. data was already written in a bad shape by the
new code before rollback), stop and do not attempt further live
changes — assess the actual data impact first. This is a "call Tony"
situation, not a "keep trying commands" situation.

---

## Quick reference — command order, both directions

| Direction | Order |
|---|---|
| **Deploy** | 1) preflight env check → 2) client+APIs → 3) verify APIs under old Rules → 4) deploy Rules → 4b) verify raw writes now denied → 5) combined smoke QA → 6) promote to prod (approval required) |
| **Rollback** | 1) restore+deploy old Rules (`rollback-firestore-rules.mjs`) → 2) VERIFY the rollback is live → 3) Vercel/client |

Client/API always leads on the way up; Rules always leads on the way
down — and a Rules rollback is never assumed to have worked without
being independently verified before the Vercel side moves.
