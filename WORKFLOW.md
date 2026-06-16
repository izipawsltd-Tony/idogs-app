# iDogs — Workflow & Commands Reference

## Deploy
```powershell
cd C:\Users\Tom\Downloads\idogs-app-phase1
npm run build
vercel deploy --prod
```
⚠️ ALWAYS use `vercel deploy --prod` — NOT `vercel --prod`

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
→ Select: Production, Preview (NOT Development for sensitive)

## Git
```powershell
git add .
git commit -m "message"
git push
```
Branch: `master` (not main)
Repo: https://github.com/izipawsltd-Tony/idogs-app

## GitHub Actions — Manual trigger
https://github.com/izipawsltd-Tony/idogs-app/actions
→ Daily Reminders → Run workflow

---

## Working Method

### File update flow
1. Tony uploads current file
2. Claude edits + outputs new file
3. Tony downloads + copies to project folder
4. `npm run build` → check errors
5. `vercel deploy --prod`

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

---

## Key Accounts & Credentials

### Firebase
- Project: `idogs-app` (asia-southeast1)
- Console: https://console.firebase.google.com

### Vercel
- Project: `idogs-app` under `izipawsltd-tonys-projects`
- Dashboard: https://vercel.com/izipawsltd-tonys-projects/idogs-app

### Stripe (Test Mode)
- Dashboard: https://dashboard.stripe.com
- Webhook: `https://idogs.com.au/api/stripe-webhook` — Active ✅
- Coupon: `EARLYBREEDER3M` (ID: cNTx0rfT) — 100% off × 3 months

### AWS
- Account: 104091534992
- IAM user: `idogs-sns` — Access Key: `AKIARQPCWY2INKYK2K4X`
- Region: `ap-southeast-2` (Sydney)
- Service: SNS — AlphaNumeric sender "iDogs"

### Resend
- API Key: `re_Ff5tyJZr_E77wAkoDVnGphL3LZKnzorxp`
- Domain: `idogs.com.au` VERIFIED ✅
- From: `noreply@idogs.com.au`

### Cloudflare
- Domain: `idogs.com.au`
- Nameservers: `gemma.ns.cloudflare.com` + `memphis.ns.cloudflare.com`
- Email routing: `info@idogs.com.au` → `izipawsltd@gmail.com` — Active ✅

### IP Australia
- TM Headstart "iDogs": filed June 2026, $200 paid
- Owner: NN Global Pty Ltd as trustee for NN Investment Trust
- Check: nninvestmenttrust@gmail.com (5 business days)
- Next: pay $330 for formal application after approval

### GitHub
- Repo: https://github.com/izipawsltd-Tony/idogs-app
- Branch: master
- Secret: CRON_SECRET added ✅
- Cron: Daily Reminders — 8am AEST (22:00 UTC)

---

## Routes Quick Reference
| URL | Page |
|---|---|
| `/` | Landing page |
| `/survey` | Breeder/Owner survey (public) |
| `/signup` | Signup |
| `/login` | Login |
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
