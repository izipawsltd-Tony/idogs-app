# iDogs.com.au — Claude Project Context

## Strategic Overview

iDogs.com.au is a **freemium consumer SaaS** serving as the **top-of-funnel acquisition channel** for iziPaws — the main B2B breeder management platform (built by ALTEK).

**Strategy:**
- iDogs → free for pet owners (1-2 dogs), paid for breeders ($5-29/month)
- iziPaws → B2B SaaS for professional Dogs Australia / ANKC breeders ($50-200/month)
- iDogs feeds iziPaws: buyer receives dog via iDogs transfer → discovers iziPaws
- Trademark "iDogs": NN Global Pty Ltd as trustee for NN Investment Trust (TM Headstart filed Jun 2026, Class 42, $200 AUD paid, Coupon ID: cNTx0rfT)
- Trademark "iziPaws": iziPaws Pty Ltd

**ANKC Note:** ANKC rebranded consumer face to **Dogs Australia** (2021). State bodies: Dogs SA, Dogs NSW, Dogs QLD, Dogs VIC, Dogs West, Dogs ACT, Dogs TAS, Dogs NT. Pedigree certs now show "Dogs SA" not "ANKC". All iDogs references use "Dogs Australia (ANKC)".

## Live URLs
- Production: https://idogs.com.au
- Vercel alias: https://idogs-app.vercel.app
- Deploy: `vercel deploy --prod` from project root (NOT `vercel --prod`)

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Auth:** Firebase Auth (global)
- **Database:** Firestore (asia-southeast1 — Singapore)
- **Storage:** Firebase Storage (asia-southeast1)
- **Email:** Resend — domain `idogs.com.au` VERIFIED ✅ — from `noreply@idogs.com.au`
- **Payments:** Stripe (test mode) — webhook active at `/api/stripe-webhook`
- **SMS:** AWS SNS — IAM user `idogs-sns` (ARN: arn:aws:iam::104091534992:user/idogs-sns) — Alphanumeric sender "iDogs"
- **Deploy:** Vercel (serverless functions in `/api/`)
- **Domain:** DNS managed by Cloudflare (nameservers: gemma.ns.cloudflare.com + memphis.ns.cloudflare.com)
- **Email routing:** Cloudflare Email Routing — `info@idogs.com.au` → `izipawsltd@gmail.com` (Active ✅)
- **Cron:** GitHub Actions — daily 8am AEST → `/api/send-reminders`

## Project Structure
```
C:\Users\Tom\Downloads\idogs-app-phase1\
├── .github/
│   └── workflows/
│       └── daily-reminders.yml  — GitHub Actions cron 8am AEST
├── api/
│   ├── scan.js                  — AI document scan (claude-sonnet-4-6)
│   ├── send-email.js            — Resend email sender (noreply@idogs.com.au)
│   ├── send-sms.js              — AWS SNS SMS sender (AlphaNumeric "iDogs") ✅ NEW
│   ├── send-reminders.js        — Daily cron: email + SMS reminders ✅ NEW
│   ├── survey.js                — Survey responses + duplicate check ✅ NEW
│   ├── upload-document.js       — Firebase Storage upload (serverless)
│   ├── upload-photo.js          — Dog profile photo upload (serverless)
│   ├── export-report.js         — PDF/CSV compliance report
│   ├── create-checkout.js       — Stripe checkout (4 plans + SMS addon)
│   └── stripe-webhook.js        — Stripe webhook handler
├── src/
│   ├── components/
│   │   ├── App.tsx              — routing + auth protection
│   │   ├── layout/AppLayout.tsx — sidebar nav (dynamic)
│   │   └── ui/
│   │       ├── AIScan.tsx       — AI scan + upload
│   │       ├── PhotoUpload.tsx  — Dog avatar upload
│   │       └── Toast.tsx
│   ├── pages/
│   │   ├── LandingPage.tsx      — marketing page (freemium pricing + survey CTA)
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx       — Breeder/Owner selector + mandatory Terms checkbox
│   │   ├── SurveyPage.tsx       — 2 paths: Breeder (10Q, 3 steps) + Owner (5Q) ✅ NEW
│   │   ├── AdminSurveyPage.tsx  — /app/admin/survey — tony only ✅ NEW
│   │   ├── DashboardPage.tsx
│   │   ├── DogListPage.tsx      — hides transferred dogs
│   │   ├── DogNewPage.tsx
│   │   ├── DogDetailPage.tsx    — tabs: Overview/AI Scan/Vaccines/Health/Reminders/QR/Timeline/Documents
│   │   ├── LittersPage.tsx      — Breeder: full / Owner: Past Litters read-only
│   │   ├── RemindersPage.tsx
│   │   ├── DocumentsPage.tsx
│   │   ├── AuditPage.tsx        — full audit trail
│   │   ├── ExportPage.tsx       — PDF/CSV export
│   │   ├── BillingPage.tsx      — 4 plans + SMS addon toggle (hidden — coming soon)
│   │   ├── SettingsPage.tsx
│   │   ├── PassportPublicPage.tsx — public QR (3 tabs: Vaccines/Health/Info)
│   │   ├── TermsPage.tsx        — SA jurisdiction, NN Global trademark clause
│   │   └── PrivacyPage.tsx      — Australian Privacy Act 1988
│   ├── hooks/useAuth.tsx
│   ├── lib/
│   │   ├── firebase.ts
│   │   ├── db.ts                — Firestore CRUD + logAudit() + getAuditLogs()
│   │   ├── email.ts
│   │   └── utils.ts
│   ├── types/index.ts
│   └── index.css                — design tokens + global styles
├── .env.local                   — Firebase config (not committed)
├── vercel.json                  — SPA routing rewrites
└── CLAUDE.md                    — this file
```

## Design System
```css
--green: #085041        /* Primary brand */
--green-mid: #1D9E75    /* Accent */
--green-light: #E1F5EE  /* Light bg */
--gold: #C8971F         /* Secondary */
--gold-light: #FDF3DC
--sand: #F5F0E8         /* Page bg */
--dark: #1A1917         /* Text primary */
--mid: #5C5A54          /* Text secondary */
--light: #9A9891        /* Text tertiary */
--border: #E2DFD8
```
Fonts: `Plus Jakarta Sans` (display) + `Inter` (body)

## Firestore Collections
- `dogs` — dog profiles (tenantId, passportId, currentOwnerId, status, buyerEmail, buyerName, microchipCertUrl)
- `users` — user profiles (role, plan, hideLitters, hideDocuments, hideReminders, emailReminders, reminderDays, smsAddon, phone, stripeCustomerId, stripeSubscriptionId)
- `vaccineRecords` — (dogId, documentUrl)
- `wormingRecords` — (dogId)
- `healthTests` — (dogId, documentUrl)
- `reminders` — (dogId)
- `activityNotes` — timeline (dogId)
- `litters` — (tenantId, puppyIds[])
- `documents` — (dogId, tenantId, documentType, fileUrl)
- `scanLogs` — QR scan audit (dogId, passportId)
- `auditLogs` — full audit (tenantId, dogId, action, details, performedBy, createdAt)
- `surveyResponses` — breeder/owner survey (email, userType, status: pending|code_sent) ✅ NEW

## CRITICAL: Firestore Rules
**NEVER use orderBy()** — requires composite indexes not auto-created. Use `where()` only, sort client-side.

```typescript
// ✅ CORRECT
const q = query(collection(db, 'dogs'), where('tenantId', '==', uid))
// ❌ WRONG
const q = query(collection(db, 'dogs'), where('tenantId', '==', uid), orderBy('createdAt'))
```

Timestamps: `data.createdAt?.toDate?.()?.toISOString() || data.createdAt || ''`

## Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;   // Required for public QR passport
      allow write: if request.auth != null;
    }
  }
}
```

## Firestore Indexes
- `auditLogs`: tenantId (Asc) + createdAt (Desc) — CREATED ✅

## Environment Variables
### .env.local (Frontend)
```
VITE_FIREBASE_API_KEY=AIzaSyAXFhks1YZkocs8CBw_QTfBp9GCPw3YUyc
VITE_FIREBASE_AUTH_DOMAIN=idogs-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=idogs-app
VITE_FIREBASE_STORAGE_BUCKET=idogs-app.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=404409556051
VITE_FIREBASE_APP_ID=1:404409556051:web:6cccd12e3ace9b5a047aa6
```

### Vercel Environment Variables (Production + Preview)
```
ANTHROPIC_API_KEY           — Claude API
RESEND_API_KEY              — re_Ff5tyJZr_E77wAkoDVnGphL3LZKnzorxp
FIREBASE_PROJECT_ID         — idogs-app
FIREBASE_CLIENT_EMAIL       — firebase-adminsdk-fbsvc@idogs-app.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY        — PKCS8 format (BEGIN PRIVATE KEY)
FIREBASE_STORAGE_BUCKET     — idogs-app.firebasestorage.app
STRIPE_SECRET_KEY           — sk_test_51TiU0W5lmfxrCiH3...
STRIPE_PUBLISHABLE_KEY      — pk_test_51TiU0W5lmfxrCiH3...
STRIPE_WEBHOOK_SECRET       — whsec_...
AWS_SNS_ACCESS_KEY_ID       — AKIARQPCWY2INKYK2K4X
AWS_SNS_SECRET_ACCESS_KEY   — (encrypted)
AWS_SNS_REGION              — ap-southeast-2
CRON_SECRET                 — UGiiAgLe51WDylGkmKFQs3xRTxUat0tGq3GOLgcgK0w
```

### GitHub Secrets
```
CRON_SECRET                 — UGiiAgLe51WDylGkmKFQs3xRTxUat0tGq3GOLgcgK0w
```

## Stripe Configuration (Test Mode)
- Webhook: `https://idogs.com.au/api/stripe-webhook` — Active ✅
- Coupon: `EARLYBREEDER3M` (ID: cNTx0rfT) — 100% off × 3 months, max 100, expires Dec 31 2026

### Price IDs (Test)
```
basic:     price_1TiaZn5lmfxrCiH3GCzSSuAy  — $5 AUD/month
pro:       price_1Tiabb5lmfxrCiH3kBdaQsRH  — $12 AUD/month
kennel:    price_1TiU7j5lmfxrCiH3J1WbbrLR  — $29 AUD/month
sms_addon: price_1Tialb5lmfxrCiH3pe82Abps  — $3 AUD/month
```

## Pricing Model (Freemium)
| Plan | Price | Dogs | Key Features |
|---|---|---|---|
| Free | $0 | 1-2 | QR Passport, health records, email reminders — forever free |
| Basic | $5/mo | 10 | + AI Scan, documents, ownership transfer, export |
| Pro | $12/mo | 20 | + Litters, audit trail, SMS reminders add-on |
| Kennel | $29/mo | Unlimited | + Full compliance export, priority support |
| SMS Add-on | +$3/mo | Any paid | SMS via AWS SNS — UI hidden until ready |

**SMS Add-on toggle is HIDDEN in BillingPage — uncomment when SMS fully tested.**

## Survey System (Market Validation)
- URL: `/survey` — public, no login required
- 2 paths: **Breeder** (10Q, 3 steps) + **Pet Owner** (5Q, 1 step)
- Saves to Firestore `surveyResponses`
- Duplicate email check — one submission per email (409 response)
- Auto-sends confirmation email to respondent + notification to `info@izipaws.com.au`
- Admin panel: `/app/admin/survey` — tony only (`trunghieungo@gmail.com`)
- Admin can send promo code `EARLYBREEDER3M` → updates status to `code_sent`
- Validation: required fields enforced before Next/Submit
- Landing page CTA: "Every dog deserves a story — help us tell it better"
- Offer: 3 months free (survey) + 3 months more (if interview booked)

## AWS SNS SMS System
- IAM user: `idogs-sns` (ARN: arn:aws:iam::104091534992:user/idogs-sns)
- Access Key: `AKIARQPCWY2INKYK2K4X`
- Region: `ap-southeast-2` (Sydney)
- Sender: AlphaNumeric "iDogs" (free, no phone number needed)
- Cost: ~$0.10 AUD/SMS, $0 fixed monthly cost
- `api/send-sms.js` — sends single SMS
- `api/send-reminders.js` — daily cron, checks Firestore, sends email + SMS
- GitHub Actions cron: `.github/workflows/daily-reminders.yml` — 8am AEST daily
- CRON_SECRET protects endpoint from unauthorized access

## Email Routing
- Cloudflare Email Routing: `info@idogs.com.au` → `izipawsltd@gmail.com` — Active ✅
- DNS managed by Cloudflare (nameservers updated at whois.com — may need 24-48h propagation)
- Resend sends FROM `noreply@idogs.com.au` (for app emails)
- Replies TO `info@izipaws.com.au` (contact email)

## Legal & IP
- Company: iziPaws Pty Ltd (ABN: 42 693 563 745)
- IP holding: NN Global Pty Ltd as trustee for NN Investment Trust (ABN: 32 693 675 491)
- Trademark "iDogs": NN Global Pty Ltd as trustee — TM Headstart filed June 2026, Class 42, $200 paid
- Trademark "iziPaws": iziPaws Pty Ltd
- **After TM Headstart approval → pay $330 for formal application**
- **Need License Agreement: NN Global → iziPaws Pty Ltd for "iDogs" trademark**
- Data storage text: "stored securely in Asia-Pacific" — NEVER mention Singapore
- Terms: SA jurisdiction — NN Global trademark clause in Section 7
- Privacy: Australian Privacy Act 1988

## File Upload (CRITICAL)
**NEVER upload directly from browser to Firebase Storage — CORS error.**
Always use serverless: `/api/upload-document` or `/api/upload-photo`

## QR Passport
- passportId format: `NNG-2023-LM3W`
- Public URL: `https://idogs.com.au/p/{passportId}`
- 3 tabs: Vaccines / Health Tests / Info

## Deploy Command
```powershell
cd C:\Users\Tom\Downloads\idogs-app-phase1
npm run build
vercel deploy --prod
```
⚠️ Use `vercel deploy --prod` NOT `vercel --prod`

## GitHub Setup
- Repo: https://github.com/izipawsltd-Tony/idogs-app — created ✅
- Branch: `master` (not `main`)
- GitHub secret `CRON_SECRET` added ✅
- Daily Reminders cron active — 8am AEST (22:00 UTC)
- Manual trigger: https://github.com/izipawsltd-Tony/idogs-app/actions → Daily Reminders → Run workflow

## Pending Items (Next Sessions)
### 🔴 Critical
- [ ] Stripe go-live — verify business, create live products (currently test mode only — cannot collect real payments yet)
- [ ] Run full end-to-end test pass (see iDogs_E2E_Test_Plan.docx) and triage bugs found

### 🟡 Important
- [ ] iziPaws CTA in iDogs — BLOCKED until iziPaws has at least a landing page/waitlist to link to (ALTEK build not done)
- [ ] License Agreement — NN Global Pty Ltd → iziPaws Pty Ltd (draft prepared, needs AU solicitor review before signing)
- [ ] TM Headstart formal application ($330) — waiting on IP Australia feedback (~5 business days), check nninvestmenttrust@gmail.com

### 🟢 Nice to Have
- [x] Delete dog UI — already implemented (button + confirm + audit log in DogDetailPage.tsx)
- [x] Worming records in Export — already implemented (CSV + PDF in export-report.js)
- [x] Mobile bottom nav — Export + Audit Trail added (sign-out removed from bottom nav, still in mobile top bar)
- [ ] Stripe go-live (duplicate of critical item above)

### 🔵 Pending External
- [ ] Cloudflare Email Routing propagate (24-48h from nameserver update)
- [ ] IP Australia TM Headstart feedback (5 business days) — check nninvestmenttrust@gmail.com
- [ ] ALTEK contract — Tony hasn't signed yet, design clock not started
- [ ] End-to-end full test (see test plan doc)

### Known bugs (carried over from iziPaws, verify if also present in iDogs scanner)
- [ ] `[object Object]` display for hipScore/elbowGrade in scanner review UI
- [ ] Hip/Elbow Date Tested not applying from scans

## Business Context
- Founder: Tony (Hieu Trung Ngo), Adelaide SA
- Admin email: `trunghieungo@gmail.com`
- Contact: `info@izipaws.com.au`
- Target ICP: Dogs Australia / ANKC registered breeders, Australia → NZ → UK → Canada
- NSW Puppy Farm Act 2024 — compliance urgency hook
- Survey promo: `EARLYBREEDER3M` — 3 months free, max 100, expires Dec 31 2026

---

## Working Method (Claude ↔ Izi)

This section exists so a brand-new chat can pick up exactly where the last one left off, without re-explaining anything.

### File update flow
1. Izi uploads the current file(s) needed for the task (Claude does not have repo access — every file must be uploaded fresh each session).
2. Claude reads the file, makes the edit, and outputs the complete updated file via `present_files`.
3. Izi downloads the file and copies it into the exact path in the project folder (Claude states the full path, e.g. `src/pages/SettingsPage.tsx`).
4. Izi runs `npm run build` locally. If it fails, Izi pastes the exact error back to Claude — Claude fixes and re-outputs the file. Repeat until build succeeds.
5. Izi deploys with `deploy` (see Shortcuts below).
6. Izi pushes with `git pp "message"` (see Shortcuts below).

### Shortcuts Izi has set up
- `deploy` — a `.bat` file in the project root that runs `npm run build` then `vercel deploy --prod` (aborts deploy if build fails). Use this instead of typing the two commands separately.
- `git pp "message"` — a global git alias equivalent to `git add . && git commit -m "message" && git push`. Already configured on Izi's machine.
- Izi works in **cmd or PowerShell**, not exclusively cmd — both work for git and npm commands on this machine.

### Conventions Claude should follow automatically
- Always give the **exact destination path** for every file Claude outputs (e.g. `src/lib/utils.ts`, not just "utils.ts").
- Never assume a file's current content — if it hasn't been uploaded in this session, ask for it before editing. Do not guess at code that hasn't been shown.
- When multiple files need uploading, name the exact folder too (e.g. "Upload `src/hooks/useAuth.tsx` and `src/components/App.tsx`") since Izi has asked for this before.
- Default deploy command reminder, if ever needed without the shortcut:
  ```
  cd C:\Users\Tom\Downloads\idogs-app-phase1
  npm run build
  vercel deploy --prod
  ```
- Branch is `master`, not `main`.
- After any change to `App.tsx`, double check it's destined for `src/components/App.tsx` — NOT `src/components/ui/App.tsx` (a past mistake that caused a build failure).
- Before creating any file/document/code, check `/mnt/skills/public/` for a relevant skill first (docx, pptx, xlsx, pdf, frontend-design, etc.).
- For anything code-related, Claude should treat CLAUDE.md as ground truth for project structure/stack/conventions, but should verify pending items against actual uploaded code before assuming something is unfinished — this file can lag behind real progress (e.g. reminderDays and Worming-in-Export were marked pending here but were already fully implemented in code).

### Communication style Izi prefers
- Direct, no fluff. Izi often says "fix ngay" (fix it now) — prioritize action over lengthy explanation.
- Izi communicates UI issues via screenshots — Claude should read these carefully for exact error text/URLs before responding.
- Izi mixes Vietnamese and English — Claude responds in whichever language fits naturally, mirroring Izi's message.
- When Izi asks for something ambiguous, Claude asks one clarifying question (via the input tool when appropriate) rather than guessing.

### What NOT to re-litigate every session
- Don't suggest re-building reminderDays — it's done (UI in SettingsPage.tsx, backend reads it correctly in send-reminders.js).
- Don't suggest the iziPaws CTA in iDogs until iziPaws has a landing page/waitlist to link to.
- Don't suggest Delete dog UI or Worming-in-Export — both already implemented.
- iDogs and iziPaws are two separate codebases/stacks (iDogs = Firebase/Vite/React; iziPaws = NestJS/PostgreSQL/AWS via ALTEK). Don't conflate file structures between them.
