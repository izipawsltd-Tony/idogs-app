# iDogs.com.au — Claude Project Context

## Strategic Overview

iDogs.com.au is a **freemium consumer SaaS** serving as the **top-of-funnel acquisition channel** for iziPaws — the main B2B breeder management platform (built by ALTEK).

**Strategy:**
- iDogs → free for pet owners (1-2 dogs), paid for breeders ($5-29/month)
- iziPaws → B2B SaaS for professional ANKC breeders ($50-200/month)
- iDogs feeds iziPaws: buyer receives dog via iDogs transfer → discovers iziPaws
- Trademark: "iDogs" owned by NN Global Pty Ltd as trustee for NN Investment Trust (TM Headstart filed Jun 2026, Class 42)

## Live URLs
- Production: https://idogs.com.au
- Vercel alias: https://idogs-app.vercel.app
- Deploy: `vercel --prod` from project root

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Auth:** Firebase Auth (global — not region-specific)
- **Database:** Firestore (asia-southeast1 — Singapore)
- **Storage:** Firebase Storage (asia-southeast1)
- **Email:** Resend — domain `idogs.com.au` VERIFIED ✅ — sends from `noreply@idogs.com.au`
- **Payments:** Stripe (test mode) — webhook active at `/api/stripe-webhook`
- **Deploy:** Vercel (serverless functions in `/api/`)
- **Domain:** whois.com — A record 76.76.21.21 + CNAME www → cname.vercel-dns.com

## Project Structure
```
C:\Users\Tom\Downloads\idogs-app-phase1\
├── api/
│   ├── scan.js                  — AI document scan (Claude claude-sonnet-4-6)
│   ├── send-email.js            — Resend email sender (noreply@idogs.com.au)
│   ├── upload-document.js       — Firebase Storage upload (serverless, avoids CORS)
│   ├── upload-photo.js          — Dog profile photo upload (serverless)
│   ├── export-report.js         — PDF/CSV compliance report generator
│   ├── create-checkout.js       — Stripe checkout session creator
│   └── stripe-webhook.js        — Stripe webhook handler (updates Firestore plan)
├── src/
│   ├── components/
│   │   ├── App.tsx              — routing + auth protection
│   │   ├── layout/
│   │   │   └── AppLayout.tsx    — sidebar nav (dynamic: hides/shows based on settings)
│   │   └── ui/
│   │       ├── AIScan.tsx       — AI scan + upload, returns fileUrl via onResult(data, fileUrl)
│   │       ├── PhotoUpload.tsx  — Dog avatar upload via /api/upload-photo serverless
│   │       └── Toast.tsx
│   ├── pages/
│   │   ├── LandingPage.tsx      — marketing page (pricing Free/$5/$12/$29 + SMS $3 addon)
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx       — Breeder/Owner selector + mandatory Terms checkbox
│   │   ├── DashboardPage.tsx    — stats + dog list + reminders
│   │   ├── DogListPage.tsx      — search + filter, hides transferred dogs
│   │   ├── DogNewPage.tsx       — create dog form
│   │   ├── DogDetailPage.tsx    — tabs: Overview/AI Scan/Vaccines/Health/Reminders/QR/Timeline/Documents
│   │   ├── LittersPage.tsx      — litter management (Breeder) or Past Litters read-only (Owner)
│   │   ├── RemindersPage.tsx    — cross-dog reminders with email button
│   │   ├── DocumentsPage.tsx    — cross-dog documents view
│   │   ├── AuditPage.tsx        — full audit trail with filter by dog/action
│   │   ├── ExportPage.tsx       — PDF/CSV export (per dog/litter/kennel)
│   │   ├── BillingPage.tsx      — 4 plans + SMS addon toggle + Stripe checkout
│   │   ├── SettingsPage.tsx     — profile edit, nav toggles, notifications, role switch
│   │   ├── PassportPublicPage.tsx — public QR page (3 tabs: Vaccines/Health/Info)
│   │   ├── TermsPage.tsx        — Terms of Service (AU law, SA jurisdiction)
│   │   └── PrivacyPage.tsx      — Privacy Policy (Australian Privacy Act 1988)
│   ├── hooks/
│   │   └── useAuth.tsx          — Firebase auth context (signup/login/logout/upgradeToBreeder)
│   ├── lib/
│   │   ├── firebase.ts          — Firebase init
│   │   ├── db.ts                — all Firestore CRUD + logAudit() + getAuditLogs()
│   │   ├── email.ts             — sendTransferEmail(), sendReminderEmail() via /api/send-email
│   │   └── utils.ts             — date helpers, breed list, life stage utils
│   ├── types/
│   │   └── index.ts             — TypeScript interfaces (VaccineRecord has documentUrl field)
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
- `users` — user profiles (role: breeder|owner, plan: trial|free|basic|pro|kennel, hideLitters, hideDocuments, hideReminders, emailReminders, reminderDays, stripeCustomerId, stripeSubscriptionId)
- `vaccineRecords` — vaccine history (dogId, documentUrl)
- `wormingRecords` — worming history (dogId)
- `healthTests` — hip/elbow/DNA/eye tests (dogId, documentUrl)
- `reminders` — vaccine/vet reminders (dogId)
- `activityNotes` — timeline notes (dogId)
- `litters` — litter management (tenantId, puppyIds[])
- `documents` — uploaded files metadata (dogId, tenantId, documentType, fileUrl)
- `scanLogs` — QR scan audit trail (dogId, passportId)
- `auditLogs` — full audit trail (tenantId, dogId, action, details, performedBy, performedByEmail, createdAt)

## CRITICAL: Firestore Rules
```
NEVER use orderBy() — requires composite indexes not auto-created.
Use where() only. Sort client-side.
```

```typescript
// ✅ CORRECT
const q = query(collection(db, 'dogs'), where('tenantId', '==', uid))

// ❌ WRONG — breaks production
const q = query(collection(db, 'dogs'), where('tenantId', '==', uid), orderBy('createdAt'))
```

**Firestore Timestamps:** Always call `.toDate().toISOString()` before sorting:
```typescript
const createdAt = data.createdAt?.toDate?.()?.toISOString() || data.createdAt || ''
```

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

## Firestore Indexes Required
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

### Vercel Environment Variables (Production)
```
ANTHROPIC_API_KEY           — Claude API for document scanning
RESEND_API_KEY              — re_Ff5tyJZr_E77wAkoDVnGphL3LZKnzorxp
FIREBASE_PROJECT_ID         — idogs-app
FIREBASE_CLIENT_EMAIL       — firebase-adminsdk-fbsvc@idogs-app.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY        — PKCS8 format (BEGIN PRIVATE KEY)
FIREBASE_STORAGE_BUCKET     — idogs-app.firebasestorage.app
STRIPE_SECRET_KEY           — sk_test_51TiU0W5lmfxrCiH3...
STRIPE_PUBLISHABLE_KEY      — pk_test_51TiU0W5lmfxrCiH3...
STRIPE_WEBHOOK_SECRET       — whsec_... (from Stripe webhook signing secret)
```

## Stripe Configuration (Test Mode)
- Account: iziPaws Pty Ltd sandbox
- Webhook: `https://idogs.com.au/api/stripe-webhook` — Active ✅
- Webhook events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted

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
| Free | $0 | 1-2 | QR Passport, health records, email reminders |
| Basic | $5/mo | 10 | + AI Scan, documents, ownership transfer, export |
| Pro | $12/mo | 20 | + Litters, audit trail, SMS reminders |
| Kennel | $29/mo | Unlimited | + Full compliance export, priority support |
| SMS Add-on | +$3/mo | Any paid | SMS reminders via Twilio (Phase 5) |

**Pet Owner:** Free forever (1-2 dogs) — no credit card

## AI Document Scan
- Endpoint: `POST /api/scan`
- Model: `claude-sonnet-4-6`
- Document types: `vaccine_card`, `pedigree`, `health_test`, `microchip_cert`, `vet_record`, `other`
- Flow: scan → upload to Storage → onResult(data, fileUrl) called AFTER upload
- fileUrl saved to: vaccineRecords.documentUrl, healthTests.documentUrl, dogs.microchipCertUrl

## File Upload (CRITICAL — Always Serverless)
**NEVER upload directly from browser to Firebase Storage — CORS error.**
Always use serverless functions:
- Documents: `POST /api/upload-document` → returns `{ fileUrl }`
- Photos: `POST /api/upload-photo` → returns `{ fileUrl }`

## Email System (Resend)
- Domain: `idogs.com.au` — VERIFIED ✅ (DNS + DKIM)
- From: `noreply@idogs.com.au`
- Templates: transfer notification, reminder email
- Contact email: `info@izipaws.com.au`

## Audit Trail
- Collection: `auditLogs`
- Actions: dog_created, dog_updated, dog_deleted, dog_transferred, vaccine_added, vaccine_deleted, health_test_added, health_test_deleted, worming_added, document_uploaded, reminder_completed, litter_created, puppy_added
- logAudit() called in: DogDetailPage (scan, transfer, delete), VaccinesTab (manual add/delete)
- Never breaks main flow (try/catch silently)

## Ownership Transfer Flow
1. Breeder clicks Transfer → enters buyer name + email
2. `transferDogOwnership()` updates dog: status='transferred', buyerEmail, buyerName, microchipCertUrl
3. Email sent to buyer via Resend
4. Buyer signs up with same email → `claimTransferredDogs()` auto-assigns dog
5. Transferred dogs hidden in DogListPage (toggle to show)

## QR Passport System
- passportId format: `NNG-2023-LM3W`
- Public URL: `https://idogs.com.au/p/{passportId}`
- No login required
- 3 tabs: Vaccines / Health Tests / Info
- Scan logged to `scanLogs` collection

## Settings (User Preferences in Firestore)
- `hideLitters` — hide Litters from nav (Breeder)
- `hideDocuments` — hide Documents from nav
- `hideReminders` — hide Reminders from nav
- `emailReminders` — enable/disable email reminders (default: true)
- `reminderDays` — lead time: 3/7/14/30 days (default: 7)
- `role` — breeder | owner (switchable in Settings)

## Account Types
- **Breeder:** Full access — litters, transfer, audit, export
- **Owner:** Limited — no litters (unless switched from Breeder with past litters → "Past Litters" read-only)
- Switch role: Settings → Account type → Switch to Breeder/Pet Owner

## Export & Compliance
- Endpoint: `POST /api/export-report`
- Scopes: dog (per dog), litter (per litter), kennel (all dogs + litters)
- Formats: PDF (HTML → print → Save as PDF) + CSV
- Covers: NSW Puppy Farm Act 2024, VIC PER, QLD, SA, WA requirements
- Page: `/app/export`

## Legal & Compliance
- Company: iziPaws Pty Ltd (ABN: 42 693 563 745, ACN: 693 563 745)
- Trademark "iDogs": NN Global Pty Ltd as trustee for NN Investment Trust (ABN 32 693 675 491) — TM Headstart filed June 2026
- Trademark "iziPaws": iziPaws Pty Ltd
- Data: Firebase asia-southeast1 (Singapore) — NOT Australia
- Legal text: "stored securely in Asia-Pacific" — never "stored in Australia"
- Terms: `/terms` — SA jurisdiction
- Privacy: `/privacy` — Australian Privacy Act 1988 compliant
- Contact: `info@izipaws.com.au`

## Firebase Authorized Domains
- localhost
- idogs-app.firebaseapp.com
- idogs-app.web.app
- idogs.com.au
- www.idogs.com.au

## Relationship to iziPaws (ALTEK)
- iDogs = consumer layer (pet owners, buyers, QR passport)
- iziPaws = B2B layer (professional breeders, kennel management, compliance)
- ALTEK contract: $17K USD, 14 modules + Buyer Portal, 10-week dev, AWS ap-southeast-2 (Sydney)
- Integration plan: iDogs transfer → webhook → iziPaws Buyer Portal (Phase 5)
- iDogs top-of-funnel CTA: "Are you a breeder? Try iziPaws →"

## Pending Items (Next Sessions)
- [ ] Remove fake testimonials from LandingPage — replace with waitlist CTA
- [ ] Email verification after signup (Firebase sendEmailVerification)
- [ ] Enforce free tier dog limit (max 2 dogs for free plan)
- [ ] "Upgrade to add more dogs" banner on DogListPage
- [ ] Twilio SMS integration (Phase 5)
- [ ] iziPaws branding in footer + Public Passport
- [ ] Stripe go-live (verify business, create live products, update keys)
- [ ] Audit litter actions (litter_created, puppy_added in LittersPage)
- [ ] iziPaws trademark transfer to NN Trust (at renewal)
- [ ] End-to-end full test

## Deploy Command
```powershell
cd C:\Users\Tom\Downloads\idogs-app-phase1
npm run build
vercel --prod
```

## Business Context
- Founder: Tony (Hieu Trung Ngo), Adelaide SA
- Company: iziPaws Pty Ltd (ABN: 42 693 563 745)
- IP holding: NN Global Pty Ltd as trustee for NN Investment Trust
- Target ICP: ANKC-registered dog breeders, Australia → NZ → UK → Canada
- NSW Puppy Farm Act 2024 — compliance urgency hook
- iDogs interview guide: `/mnt/project/iziPaws_Interview_Guide.docx`
