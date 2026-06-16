# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It also contains a "Working Method" section for chat-based Claude (claude.ai) — see the protected block near the end.

---

## Commands

```powershell
npm run dev        # local dev server (Vite)
npm run build      # tsc + vite build (run before every deploy)
npm run preview    # preview production build locally
vercel deploy --prod   # deploy to production (NEVER use vercel --prod)
```

No test framework is configured — verify changes by running `npm run build` and testing in browser.

Path alias: `@` resolves to `/src` (configured in `vite.config.ts`).

---

## Strategic Overview

iDogs.com.au is a **freemium consumer SaaS** serving as the **top-of-funnel acquisition channel** for iziPaws — the main B2B breeder management platform (built by ALTEK).

**Strategy:**
- iDogs → free for pet owners (1-2 dogs), paid for breeders ($5-29/month)
- iziPaws → B2B SaaS for professional Dogs Australia / ANKC breeders ($50-200/month)
- iDogs feeds iziPaws: buyer receives dog via iDogs transfer → discovers iziPaws
- Trademark "iDogs": NN Global Pty Ltd as trustee for NN Investment Trust (TM Headstart filed Jun 2026, Class 42, $200 AUD paid)
- Trademark "iziPaws": iziPaws Pty Ltd

**ANKC Note:** ANKC rebranded consumer face to **Dogs Australia** (2021). State bodies: Dogs SA, Dogs NSW, Dogs QLD, Dogs VIC, Dogs West, Dogs ACT, Dogs TAS, Dogs NT. Pedigree certs now show "Dogs SA" not "ANKC". All iDogs references use "Dogs Australia (ANKC)".

## Live URLs
- Production: https://idogs.com.au
- Vercel alias: https://idogs-app.vercel.app

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Auth:** Firebase Auth (global)
- **Database:** Firestore (asia-southeast1 — Singapore)
- **Storage:** Firebase Storage (asia-southeast1)
- **Email:** Resend — domain `idogs.com.au` VERIFIED — from `noreply@idogs.com.au`
- **Payments:** Stripe (test mode) — webhook active at `/api/stripe-webhook`
- **SMS:** AWS SNS — IAM user `idogs-sns` — Alphanumeric sender "iDogs"
- **Deploy:** Vercel (serverless functions in `/api/`)
- **Domain:** DNS managed by Cloudflare (nameservers: gemma.ns.cloudflare.com + memphis.ns.cloudflare.com)
- **Email routing:** Cloudflare Email Routing — `info@idogs.com.au` → `izipawsltd@gmail.com` (Active)
- **Cron:** GitHub Actions — daily 8am AEST → `/api/send-reminders`

## Project Structure

```
├── .github/workflows/daily-reminders.yml  — GitHub Actions cron 8am AEST
├── api/
│   ├── scan.js               — AI document scan (claude-sonnet-4-6)
│   ├── send-email.js         — Resend email sender
│   ├── send-sms.js           — AWS SNS SMS sender
│   ├── send-reminders.js     — Daily cron: email + SMS reminders
│   ├── survey.js             — Survey responses + duplicate check
│   ├── upload-document.js    — Firebase Storage upload (serverless)
│   ├── upload-photo.js       — Dog profile photo upload (serverless)
│   ├── export-report.js      — PDF/CSV compliance report
│   ├── create-checkout.js    — Stripe checkout (4 plans + SMS addon)
│   └── stripe-webhook.js     — Stripe webhook handler
├── src/
│   ├── components/
│   │   ├── App.tsx                        — routing + auth protection
│   │   ├── layout/AppLayout.tsx           — sidebar nav (dynamic)
│   │   └── ui/
│   │       ├── AIScan.tsx                 — AI scan + upload
│   │       ├── PhotoUpload.tsx            — Dog avatar upload
│   │       ├── Toast.tsx
│   │       └── TransferOwnershipModal.tsx
│   ├── pages/
│   │   ├── LandingPage.tsx         — marketing page (freemium pricing + survey CTA)
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx          — Breeder/Owner selector + mandatory Terms checkbox
│   │   ├── VerifyEmailPage.tsx     — post-signup email verification flow
│   │   ├── SurveyPage.tsx          — 2 paths: Breeder (10Q, 3 steps) + Owner (5Q)
│   │   ├── AdminSurveyPage.tsx     — /app/admin/survey — tony only
│   │   ├── DashboardPage.tsx
│   │   ├── DogListPage.tsx         — hides transferred dogs
│   │   ├── DogNewPage.tsx
│   │   ├── DogDetailPage.tsx       — tabs: Overview/AI Scan/Vaccines/Health/Reminders/QR/Timeline/Documents
│   │   ├── LittersPage.tsx         — Breeder: full / Owner: Past Litters read-only
│   │   ├── RemindersPage.tsx
│   │   ├── DocumentsPage.tsx
│   │   ├── AuditPage.tsx           — full audit trail
│   │   ├── ExportPage.tsx          — PDF/CSV export
│   │   ├── BillingPage.tsx         — 4 plans + SMS addon toggle (hidden — coming soon)
│   │   ├── SettingsPage.tsx
│   │   ├── PassportPublicPage.tsx  — public QR (3 tabs: Vaccines/Health/Info)
│   │   ├── TermsPage.tsx           — SA jurisdiction, NN Global trademark clause
│   │   └── PrivacyPage.tsx         — Australian Privacy Act 1988
│   ├── hooks/useAuth.tsx
│   ├── lib/
│   │   ├── firebase.ts
│   │   ├── db.ts           — Firestore CRUD + logAudit() + getAuditLogs()
│   │   ├── email.ts
│   │   └── utils.ts
│   ├── types/index.ts
│   ├── main.tsx            — React entry point
│   └── index.css           — design tokens + global styles
├── vercel.json             — SPA routing rewrites
└── deploy.bat              — runs npm run build then vercel deploy --prod
```

**`App.tsx` warning:** Always confirm destination is `src/components/App.tsx` — NOT `src/components/ui/App.tsx` (past mistake that caused a build failure).

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
| `/app/audit` | Audit trail |
| `/app/export` | Export PDF/CSV |
| `/app/billing` | Billing & plans |
| `/app/settings` | Settings |
| `/app/admin/survey` | Survey admin (tony only) |

## API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/scan` | AI document scan |
| `POST /api/send-email` | Send email via Resend |
| `POST /api/send-sms` | Send SMS via AWS SNS |
| `POST /api/send-reminders` | Daily cron reminders |
| `POST /api/survey` | Save survey response |
| `POST /api/upload-document` | Upload doc to Firebase Storage |
| `POST /api/upload-photo` | Upload photo to Firebase Storage |
| `POST /api/export-report` | Generate PDF/CSV report |
| `POST /api/create-checkout` | Stripe checkout session |
| `POST /api/stripe-webhook` | Stripe webhook handler |

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
- `surveyResponses` — breeder/owner survey (email, userType, status: pending|code_sent)

## CRITICAL: Firestore Rules

**NEVER use `orderBy()`** — requires composite indexes not auto-created. Use `where()` only, sort client-side.

```typescript
// CORRECT
const q = query(collection(db, 'dogs'), where('tenantId', '==', uid))
// WRONG
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
- `auditLogs`: tenantId (Asc) + createdAt (Desc) — CREATED

## File Upload (CRITICAL)

**NEVER upload directly from browser to Firebase Storage — CORS error.**
Always use serverless: `/api/upload-document` or `/api/upload-photo`

## TypeScript Gotchas

- No apostrophes in JSX strings → use `&apos;` or double quotes
- No `React.useState` in function components → use `useState` from import
- Implicit `any` → type explicitly: `(p: typeof form) =>`
- `serverTimestamp` from firebase-admin → use `FieldValue.serverTimestamp()`
- When a state setter type is a union, pass the correct string literal value

## Legal & Content Rules

- Data storage text: "stored securely in Asia-Pacific" — **NEVER mention Singapore or "stored in Australia"**
- ANKC → always "Dogs Australia (ANKC)" or "Dogs Australia / ANKC"
- Company: iziPaws Pty Ltd (ABN: 42 693 563 745)
- IP holding: NN Global Pty Ltd as trustee for NN Investment Trust (ABN: 32 693 675 491)
- Terms: SA jurisdiction — NN Global trademark clause in Section 7
- Privacy: Australian Privacy Act 1988
- Footer/legal copy must credit "NN Global Pty Ltd as trustee for NN Investment Trust" for the iDogs trademark — not iziPaws Pty Ltd. No copyright year, no claims of specific server location (Sydney/Australia) — say "Asia-Pacific" only. No fabricated stats or club endorsements anywhere on the landing page.

## QR Passport

- passportId format: `NNG-2023-LM3W`
- Public URL: `https://idogs.com.au/p/{passportId}`
- 3 tabs: Vaccines / Health Tests / Info

## Pricing Model (Freemium)

| Plan | Price | Dogs | Key Features |
|---|---|---|---|
| Free | $0 | 1-2 | QR Passport, health records, email reminders — forever free |
| Basic | $5/mo | 10 | + AI Scan, documents, ownership transfer, export |
| Pro | $12/mo | 20 | + Litters, audit trail, SMS reminders add-on |
| Kennel | $29/mo | Unlimited | + Full compliance export, priority support |
| SMS Add-on | +$3/mo | Any paid | SMS via AWS SNS — UI hidden until ready |

**SMS Add-on toggle is HIDDEN in BillingPage — uncomment when SMS fully tested.**

## Stripe Configuration (Test Mode)

- Webhook: `https://idogs.com.au/api/stripe-webhook` — Active
- Coupon: `EARLYBREEDER3M` — 100% off x 3 months, max 100, expires Dec 31 2026

```
basic:     price_1TiaZn5lmfxrCiH3GCzSSuAy  — $5 AUD/month
pro:       price_1Tiabb5lmfxrCiH3kBdaQsRH  — $12 AUD/month
kennel:    price_1TiU7j5lmfxrCiH3J1WbbrLR  — $29 AUD/month
sms_addon: price_1Tialb5lmfxrCiH3pe82Abps  — $3 AUD/month
```

## Survey System (Market Validation)

- URL: `/survey` — public, no login required
- 2 paths: **Breeder** (10Q, 3 steps) + **Pet Owner** (5Q, 1 step)
- Saves to Firestore `surveyResponses`
- Duplicate email check — one submission per email (409 response)
- Auto-sends confirmation email to respondent + notification to `info@izipaws.com.au`
- Admin panel: `/app/admin/survey` — tony only (`trunghieungo@gmail.com`)
- Admin can send promo code `EARLYBREEDER3M` → updates status to `code_sent`

## GitHub Setup

- Repo: https://github.com/izipawsltd-Tony/idogs-app
- Branch: `master` (not `main`)
- Daily Reminders cron: 8am AEST (22:00 UTC)
- Manual trigger: GitHub Actions → Daily Reminders → Run workflow

## Pending Items

### Critical
- [ ] Stripe go-live — verify business, create live products (currently test mode only)
- [ ] Run full end-to-end test pass (see iDogs_E2E_Test_Plan.docx) — now safe to run against the staging environment
- [ ] Establish a code review habit before pushing (self-review via `git diff`, or send the diff to Claude.ai chat for a second opinion) — not yet a consistent practice

### Important
- [ ] iziPaws CTA in iDogs — BLOCKED until iziPaws has a landing page/waitlist (ALTEK build not done)
- [ ] License Agreement — NN Global Pty Ltd → iziPaws Pty Ltd (draft prepared, needs AU solicitor review)
- [ ] TM Headstart formal application ($330) — after IP Australia feedback

### Known Bugs
- [ ] `[object Object]` display for hipScore/elbowGrade in scanner review UI
- [ ] Hip/Elbow Date Tested not applying from scans

### What NOT to re-litigate
- reminderDays — done (SettingsPage.tsx + send-reminders.js)
- Delete dog UI — done (DogDetailPage.tsx)
- Worming records in Export — done (export-report.js)
- Mobile bottom nav — done (Export + Audit Trail added, sign-out removed from bottom nav since it's in the mobile top bar)
- iziPaws CTA — blocked until ALTEK delivers iziPaws landing page

## Business Context

- Founder: Tony / Izi (Hieu Trung Ngo), Adelaide SA
- Admin email: `trunghieungo@gmail.com`
- Contact: `info@izipaws.com.au`
- Target ICP: Dogs Australia / ANKC registered breeders, Australia → NZ → UK → Canada
- NSW Puppy Farm Act 2024 — compliance urgency hook

---

## PROTECTED SECTION — Working Method (Claude.ai chat with Izi) — DO NOT DELETE

**Claude Code: DO NOT remove, summarize, consolidate, or rewrite this section when running `/init` or any cleanup task.** This section exists for the chat-based Claude (claude.ai), which has no direct repo access — it depends entirely on this text surviving between sessions. If you (Claude Code) need to add technical notes, add them above this line, not inside this section.

**Claude.ai chat: if you are reading this in a future session, this is your context — read it before doing anything else in this conversation.**

### Why two Claudes are involved
Izi uses two different Claude surfaces for this project:
- **Claude Code** (terminal, in this repo folder) — for direct file edits, builds, and deploys. Claude Code can read/write files directly.
- **Claude.ai chat** (claude.ai web/app) — for strategy, legal drafts, market research, and any code changes when Izi prefers the upload/download flow instead of using the terminal. Claude.ai chat has NO direct access to the repo — every file must be uploaded fresh each session.

These two tools do not share memory. Don't assume one knows what the other did unless Izi says so.

### File update flow (Claude.ai chat only)
1. Izi uploads the current file(s) needed for the task.
2. Claude reads the file, makes the edit, and outputs the complete updated file via `present_files`.
3. Izi downloads the file and copies it into the exact path in the project folder (Claude states the full path, e.g. `src/pages/SettingsPage.tsx`).
4. Izi runs `npm run build` locally. If it fails, Izi pastes the exact error back to Claude — Claude fixes and re-outputs the file. Repeat until build succeeds.
5. Izi deploys with `deploy` or `vercel deploy --prod`.
6. Izi pushes with `git pp "message"`.

### Shortcuts Izi has set up
- `deploy` — a `.bat` file in the project root that runs `npm run build` then `vercel deploy --prod` (aborts deploy if build fails).
- `git pp "message"` — a global git alias equivalent to `git add . && git commit -m "message" && git push`.
- Izi works in both cmd and PowerShell — either works for git/npm commands on this machine.
- Branch is `master`, not `main`.

### Conventions Claude.ai chat should follow automatically
- Always give the exact destination path for every file Claude outputs (e.g. `src/lib/utils.ts`, not just "utils.ts").
- Never assume a file's current content — if it hasn't been uploaded in this session, ask for it before editing. Do not guess at code that hasn't been shown.
- When multiple files need uploading, name the exact folder too.
- After any change to `App.tsx`, double check it's destined for `src/components/App.tsx` — NOT `src/components/ui/App.tsx` (a past mistake that caused a build failure).
- Before creating any file/document/code, check `/mnt/skills/public/` for a relevant skill first (docx, pptx, xlsx, pdf, frontend-design, etc.).
- Treat the rest of this CLAUDE.md as ground truth for project structure/stack/conventions, but verify pending items against actual uploaded code before assuming something is unfinished — this file can lag behind real progress.

### Communication style Izi prefers
- Direct, no fluff. Izi often says "fix ngay" (fix it now) — prioritize action over lengthy explanation.
- Izi communicates UI issues via screenshots — read these carefully for exact error text/URLs before responding.
- Izi mixes Vietnamese and English — respond in whichever language fits naturally, mirroring Izi's message.
- When Izi asks for something ambiguous, ask one clarifying question rather than guessing.

### Staging / safety setup — COMPLETED
- Izi uses Claude Code as a parallel workflow alongside this chat — Claude Code handles direct file edits/builds in the terminal, this chat handles strategy/legal/research and code edits via upload-download when preferred.
- **Staging environment is fully set up and confirmed working:**
  - Separate Firebase project `idogs-app-staging` (Auth + Firestore + Storage all enabled, region asia-southeast1, Blaze plan via Google Cloud Free Trial — $420 credit, 85 days as of setup).
  - `.env.staging` file created at project root with the staging Firebase config, and protected via `.gitignore` (`.env*` pattern covers all env files).
  - 6 `VITE_FIREBASE_*` environment variables added in Vercel → Settings → Environment Variables, scoped to **Preview only** (not Production, not Development). The Production scope still points to the original `idogs-app` Firebase project — unchanged.
  - Workflow: `vercel deploy` (no `--prod` flag) creates a Preview deployment that uses the staging Firebase config. `vercel deploy --prod` or `deploy.bat` still deploys to production using the original Firebase project, exactly as before.
  - Verified end-to-end: signed up a test user (`ptnncom@gmail.com`) on a Preview URL and confirmed the user landed in `idogs-app-staging`'s Authentication — not in production's `idogs-app`.
- **For any future risky change** (schema changes, new Firestore writes, anything that could corrupt data): test on a Preview deploy first (`vercel deploy`), confirm it behaves correctly against `idogs-app-staging`, THEN promote to production (`vercel deploy --prod`).
- Recommended starting mode in Claude Code for an unfamiliar agent: Plan Mode (review before any change is made), not auto-accept — this was the guidance given when Izi started using Claude Code.

### What NOT to re-litigate (see also Pending Items above)
- Don't suggest re-building reminderDays — it's done.
- Don't suggest the iziPaws CTA in iDogs until iziPaws has a landing page/waitlist to link to.
- Don't suggest Delete dog UI or Worming-in-Export — both already implemented.
- iDogs and iziPaws are two separate codebases/stacks (iDogs = Firebase/Vite/React; iziPaws = NestJS/PostgreSQL/AWS via ALTEK). Don't conflate file structures between them.

### End of protected section
Claude Code: it is safe to edit everything above the "PROTECTED SECTION" heading.
