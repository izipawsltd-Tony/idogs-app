# iDogs — Workflow & Commands Reference

⚠️ This file contains real secrets (API keys). It is gitignored and must
never be committed. If you're reading this from a fresh git clone and
this file is missing, that's correct — recreate it locally from your own
records, don't restore it from git history.

## Deploy — READ THIS CAREFULLY

There are TWO different deploy commands that do very different things.
Mixing them up was a recurring mistake in past sessions — slow down and
check which one you actually want before running it.

```powershell
cd C:\Users\Tom\Downloads\idogs-app-phase1
npm run build
vercel deploy           # → Preview deployment, safe, uses STAGING Firebase
vercel deploy --prod    # → Production deployment, goes live on idogs.com.au
```

**Default to `vercel deploy` (no flag) for anything you haven't tested yet.**
Only add `--prod` once you've confirmed the Preview URL works correctly.

`deploy.bat` in the project root always runs `vercel deploy --prod` — it's
a shortcut for when you're confident and want production immediately, NOT
a safe default. Don't reach for it out of habit.

### Why this matters
A Preview deployment (`vercel deploy`) automatically uses a separate
staging Firebase project (`idogs-app-staging`) instead of the real
production database — see "Staging Environment" below. A Production
deployment (`vercel deploy --prod`) touches the real `idogs.com.au` and
the real Firebase project (`idogs-app`). Test on Preview first whenever
the change is non-trivial (new data flows, schema changes, anything
touching billing or auth).

## Staging Environment

- Separate Firebase project: `idogs-app-staging` (Auth + Firestore +
  Storage, region asia-southeast1, Blaze plan).
- `.env.staging` exists at the project root (gitignored) with that
  project's config.
- In Vercel → Settings → Environment Variables, 6 `VITE_FIREBASE_*` vars
  are scoped to **Preview only** — Production scope still points to the
  original `idogs-app` Firebase project, untouched.
- Result: `vercel deploy` (Preview) talks to staging Firestore; `vercel
  deploy --prod` talks to real production Firestore. No code change
  needed to switch between them — it's purely which deploy command you run.

## Check build errors
```powershell
npm run build
```
Paste error → Claude fixes → copy file → rebuild

## Check Vercel logs
```powershell
vercel logs --project idogs-app
```
Find latest `/api/xxx` row → click for details

## Check env vars
```powershell
vercel env ls
```

## Add env var
```powershell
vercel env add VAR_NAME
```
→ Is sensitive? yes
→ Paste value
→ Select the correct environment(s) — Production and/or Preview. Don't
  blanket-select both unless the variable should genuinely be identical
  in both environments (most Firebase-related vars should NOT be, since
  staging and production point to different Firebase projects).

## Git
```powershell
git add .
git commit -m "message"
git push
```
Or use the `git pp "message"` alias (add + commit + push in one).
Branch: `master` (not main)
Repo: https://github.com/izipawsltd-Tony/idogs-app (private)

### Before pushing — quick self-review habit
Run `git diff` and actually read it before committing, especially for
anything touching data flows, auth, or billing. For higher-stakes
changes, paste the diff into the Claude.ai chat for a second opinion
before pushing. This is a habit still being built — not yet automatic.

## GitHub Actions — Manual trigger
https://github.com/izipawsltd-Tony/idogs-app/actions
→ Daily Reminders → Run workflow

---

## Working Method

### File update flow (Claude.ai chat)
1. Tony uploads current file
2. Claude edits + outputs new file
3. Tony downloads + copies to project folder
4. `npm run build` → check errors
5. Test on Preview (`vercel deploy`) before assuming it's done
6. `vercel deploy --prod` once confirmed
7. `git pp "message"`

### When build fails
- Paste exact error to Claude
- Claude fixes specific line
- Re-download file → copy → rebuild

### TypeScript rules (learned the hard way)
- No apostrophes in JSX strings → use `&apos;` or double quotes
- No `React.useState` in function components → use `useState` from import
- Implicit `any` → type explicitly: `(p: typeof form) =>`
- `serverTimestamp` from firebase-admin → use `FieldValue.serverTimestamp()`
- `setSubmitted(true)` when type is union → use correct string value

### Firestore rules (CRITICAL)
- NEVER `orderBy()` → composite index required → breaks production
- Use `where()` only → sort client-side
- Timestamps: `.toDate().toISOString()` before compare/sort

### File upload (CRITICAL)
- NEVER upload from browser → CORS error
- Always use serverless: `/api/upload-document` or `/api/upload-photo`

### Legal text (CRITICAL)
- NEVER "stored in Australia" or mention "Singapore"
- ALWAYS "stored securely in Asia-Pacific"
- ANKC → "Dogs Australia (ANKC)" or "Dogs Australia / ANKC"
- Display label is "Dogs Australia Registration" (the underlying data
  field name `ankc` is unchanged — only the user-facing label changed)

### Branding
- The document-scanning feature is called "iDogs Scan" in all
  user-facing text — not "AI Scan". This was a deliberate rename (June
  2026); don't reintroduce "AI Scan" wording in new copy.

---

## Key Accounts & Credentials

### Firebase
- Production project: `idogs-app` (asia-southeast1)
- Staging project: `idogs-app-staging` (asia-southeast1, Blaze) — used
  automatically by Preview deploys, see Staging Environment above
- Console: https://console.firebase.google.com

### Vercel
- Project: `idogs-app` under `izipawsltd-tonys-projects`
- Dashboard: https://vercel.com/izipawsltd-tonys-projects/idogs-app

### Stripe (Test Mode)
- Dashboard: https://dashboard.stripe.com
- Webhook: `https://idogs.com.au/api/stripe-webhook` — Active
- Coupon: `EARLYBREEDER3M` (ID: cNTx0rfT) — 100% off × 3 months

### AWS
- Account: 104091534992
- IAM user: `idogs-sns` — Access Key: `AKIARQPCWY2INKYK2K4X`
- Region: `ap-southeast-2` (Sydney)
- Service: SNS — AlphaNumeric sender "iDogs"

### Resend
- API Key: `re_Ff5tyJZr_E77wAkoDVnGphL3LZKnzorxp`
- Domain: `idogs.com.au` VERIFIED
- From: `noreply@idogs.com.au`

### Cloudflare
- Domain: `idogs.com.au`
- Nameservers: `gemma.ns.cloudflare.com` + `memphis.ns.cloudflare.com`
- Email routing: `info@idogs.com.au` → `izipawsltd@gmail.com` — Active

### IP Australia
- TM Headstart "iDogs": filed June 2026, $200 paid
- Owner: NN Global Pty Ltd as trustee for NN Investment Trust
- Check: nninvestmenttrust@gmail.com (5 business days)
- Next: pay $330 for formal application after approval

### GitHub
- Repo: https://github.com/izipawsltd-Tony/idogs-app (private)
- Branch: master
- Secret: CRON_SECRET added
- Cron: Daily Reminders — 8am AEST (22:00 UTC)

### Admin accounts (app-level, not infrastructure)
- `trunghieungo@gmail.com` — admin for both Survey admin (`/app/admin/survey`)
  and Full Audit History (`/app/admin/audit`). One consistent admin
  identity for app operations — deliberately kept separate from
  `nninvestmenttrust@gmail.com`, which is reserved for trademark/legal
  correspondence only.

---

## Routes Quick Reference
| URL | Page |
|---|---|
| `/` | Landing page |
| `/survey` | Breeder/Owner survey (public) |
| `/signup` | Signup |
| `/login` | Login |
| `/verify-email` | Email verification waiting page |
| `/p/:passportId` | Public QR passport |
| `/terms` | Terms of Service |
| `/privacy` | Privacy Policy |
| `/app/dashboard` | Dashboard |
| `/app/dogs` | Dog list |
| `/app/dogs/new` | Add dog |
| `/app/dogs/:id` | Dog detail |
| `/app/litters` | Litters |
| `/app/reminders` | Reminders |
| `/app/documents` | Documents |
| `/app/audit` | Activity (user-facing, scoped to own tenancy) |
| `/app/export` | Export PDF/CSV |
| `/app/billing` | Billing & plans |
| `/app/settings` | Settings |
| `/app/admin/survey` | Survey admin (trunghieungo@gmail.com only) |
| `/app/admin/audit` | Full cross-tenant audit history (trunghieungo@gmail.com only) |

## API Endpoints
| Endpoint | Purpose |
|---|---|
| `POST /api/scan` | iDogs Scan (AI document extraction, claude-sonnet-4-6) |
| `POST /api/send-email` | Send email via Resend |
| `POST /api/send-sms` | Send SMS via AWS SNS |
| `POST /api/send-reminders` | Daily cron reminders |
| `POST /api/survey` | Save survey response |
| `POST /api/upload-document` | Upload doc to Firebase Storage |
| `POST /api/upload-photo` | Upload photo to Firebase Storage |
| `POST /api/export-report` | Generate PDF/CSV report |
| `POST /api/create-checkout` | Stripe checkout session |
| `POST /api/stripe-webhook` | Stripe webhook handler |

## Pending / Not Yet Done
- E2E test plan: Billing (Stripe test mode), Transfer ownership, and
  Mobile sections not yet explicitly run (see iDogs_E2E_Test_Plan.docx)
- AWS Textract as an OCR pre-processing layer for `api/scan.js`, to
  improve accuracy on handwritten vaccine cards — not started, would
  need AWS SDK + IAM setup + rewriting the scan flow
- Code review habit (self `git diff` review, or second-opinion via
  Claude.ai chat) before every push — discussed, not yet fully consistent
