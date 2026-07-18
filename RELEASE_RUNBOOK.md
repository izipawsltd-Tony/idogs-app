# Release Runbook — Litter / Heat Cycle / Puppy server-side rewrite

Covers the release that moves litter create/update/delete, heat cycle
create/update, and puppy creation onto trusted server endpoints, with
firestore.rules denying the equivalent direct client writes (Codex round
3 + round 4 remediation, `fix/sire-heat-cycle` branch). Use this runbook
for THIS release; treat it as a template for any future release that
pairs new server endpoints with newly-restrictive Firestore Rules — the
ordering problem (Step 2 vs Step 3 below) is general, not specific to
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

## 3. Smoke-test the combined release (client + APIs, OLD Rules still live)

Against the Preview URL from Step 2, confirm (staging Firebase project
`idogs-app-staging`, per `CLAUDE.md` — never test against production
data):

- [ ] Create a litter with a valid Dam → succeeds, litter appears.
- [ ] Create a litter with an underage/transferred/wrong-sex Dam →
      rejected with a specific reason (not a generic 500).
- [ ] Add a puppy to a litter → succeeds, QR passport created.
- [ ] Click "Add & create passport" twice quickly (or reload mid-request
      and retry) → puppy is created exactly once, no duplicate.
- [ ] Edit a litter's actual birth date → still-owned puppies' DOBs
      update; a transferred puppy's DOB does not change.
- [ ] Remove a puppy from a litter (unlink, not delete) → puppy stays in
      "My Dogs", litter's puppy count drops.
- [ ] Delete a litter with puppies still in your care → litter and those
      puppies are gone; a transferred/claimed puppy from the same litter
      survives.
- [ ] Record a Heat Cycle for an eligible Dam → succeeds.
- [ ] Edit an existing Heat Cycle record → succeeds even if the Dam has
      since been transferred (historical-record editing must still work).
- [ ] Open browser devtools console and attempt a raw Firestore write to
      `litters/{id}` (update or delete) and to `heatCycles/{id}` (create
      or update) → all denied. (This proves the OLD Rules are still
      live and the NEW client simply isn't using the paths they'd allow
      — Step 4 is what actually closes them.)

**Stop condition:** any checkbox fails → fix and restart from Step 2.
Do not proceed to Step 4 with a failing smoke test — Step 4 removes the
Rules-level safety net for the OLD code paths, and if the NEW code has a
bug, you want the OLD (permissive) Rules still available as a fallback
while you fix it.

---

## 4. Deploy restrictive Firestore Rules SECOND

Only after Step 3 is fully green:

```powershell
firebase deploy --only firestore:rules --project idogs-app-staging
```

Re-run the FULL Step 3 smoke test against the same Preview URL —
this time the devtools direct-write checks should already have been
denied (they were, by the old rules too, for THIS release's specific
changes — this second pass exists to confirm nothing else in the app
regressed against the tightened rules, e.g. dogs.delete's new
history-field checks).

**Stop condition:** any regression → **rollback immediately** (Step 6),
do not attempt a forward-fix under live traffic.

---

## 5. Promote to production (only after explicit approval)

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

## 6. Already-open old SPA sessions

Vite ships a content-hashed bundle — a browser tab left open across a
deploy keeps running the OLD JavaScript already loaded into memory until
the user navigates in a way that re-fetches `index.html`, or does a hard
refresh. Between Step 4/5 (Rules tightened) and whenever each such
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
- **Give it time**: prefer deploying Step 4/5 at a low-traffic time and
  waiting a short interval (15–30 minutes is reasonable at this app's
  current traffic) after Step 2/5's client deploy before running Step
  4/5's Rules deploy, so most active sessions have naturally refreshed
  (new page load, tab reopened, etc.) before Rules tighten.
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

## 7. Rollback — Rules BEFORE Vercel, always

If anything goes wrong after Step 4/5, roll back in the OPPOSITE order
of how you deployed — Rules first, then Vercel:

```powershell
# 1. Roll back Rules FIRST
git show <previous-good-commit>:firestore.rules > firestore.rules.rollback
firebase deploy --only firestore:rules --project idogs-app-staging   # or idogs-app for production, after approval
# (or, faster: Firebase Console → Firestore → Rules → History → select
#  the previous version → Publish — avoids a local checkout mismatch)

# 2. Roll back Vercel SECOND
vercel rollback                          # rolls the alias back to the previous deployment
# or: vercel deploy --prod (after approval) from a checkout of the previous commit
```

**Why Rules first:** the previous (pre-release) client bundle expects
the OLD, more permissive Rules — it still does direct Firestore writes
for litters/heatCycles that the NEW Rules deny. If you roll back Vercel
first while the NEW (restrictive) Rules are still live, the OLD client
you just restored will immediately start failing on writes it expects
to succeed — the exact same class of mismatch Step 6 describes, just in
the reverse direction. Rolling back Rules first restores the permissive
baseline the OLD client actually needs, THEN restoring the OLD client
is safe.

**Stop condition / escalation:** if rolling back Rules alone doesn't
resolve the issue (e.g. data was already written in a bad shape by the
new code before rollback), stop and do not attempt further live
changes — assess the actual data impact first. This is a "call Tony"
situation, not a "keep trying commands" situation.

---

## Quick reference — command order, both directions

| Direction | Order |
|---|---|
| **Deploy** | 1) preflight env check → 2) client+APIs → 3) smoke test → 4) Rules → 5) promote to prod (approval required) |
| **Rollback** | 1) Rules → 2) Vercel/client |

Client/API always leads on the way up; Rules always leads on the way
down.
