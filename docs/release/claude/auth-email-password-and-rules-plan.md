# Email + password for SMS accounts, and Firestore Rules hardening — migration & rollback plan

Branch `claude/auth-email-password-20261102`, based on live `2da4f0d` (base `claude/live-baseline-2da4f0d`).
Owner directive: #69 comment 6564223316. Selective port of PR #68 commits `30dd993` + `c20c8c5` only.

## 1. Business workflow implemented
| Customer | What they see in Settings → "Email & password sign-in" | Firebase operation |
|---|---|---|
| Email + password already | Card hidden | none |
| SMS only, no email | Step 1: enter email → one-time link emailed → opening it (same device, signed in) attaches the address **already verified** | `sendSignInLinkToEmail` → `linkWithCredential(EmailAuthProvider.credentialWithLink)` on the **same UID** |
| SMS + unverified email | Step 1: Verify email (existing `/verify-email`) | `sendEmailVerification` |
| Any of the above, now verified | Step 2: choose password | `updatePassword()` on the **same UID** |

- Never creates, merges or switches a user; never attaches an unverified address (no email squatting / typo lock-out).
- Email owned by another account: Firebase refuses the link (`email-already-in-use`); no-merge message; both accounts unchanged.
- Link opened on another device or by a different signed-in account: refused, nothing attached; the one-time code is removed from the address bar.
- Old/revoked session (`requires-recent-login`, `user-token-expired`): clear "sign in again with your mobile number" message; nothing changes.
- Phone/SMS sign-in is **unchanged**. Signup, `/login` and the SMS OTP flow are not modified.
- If a customer stops after step 1, they already have a verified email; "Forgot password" then sets a password on the same UID.
- iOS app (email/password only) and any future native client: works with the resulting credential; no native change needed.
- Not ported from #68: Owner's unreleased phone-login changes `68d319f`, `b6fedc5`, `b43218e` (not QA'd).

### Why not `verifyBeforeUpdateEmail` (used by live `/verify-email`)?
Firebase requires an existing email for it. The Auth emulator rejects it for a phone-only account with `auth/missing-email` (CI evidence case 0). If production behaves the same, **live `/verify-email` cannot add an email for SMS-only customers today** — to be confirmed on staging (QA step 1).

### Firebase console precondition (Owner, auth config)
The emailed-link step needs **Authentication → Sign-in method → Email/Password → "Email link (passwordless sign-in)" ON** — first in `idogs-app-staging`, later in `idogs-app`. Production `/api/auth-options` currently reports `emailLink: false`. While it is off the card shows "Adding an email isn't available yet" — nothing breaks. Side effect of enabling: none in the current UI (`/login` and `/signup` use the mobile-number form; the email-link sign-in UI stays unused).

## 2. Data preservation
All dogs, documents, QR passports, timeline entries and Stripe/Plus fields are keyed on the Firebase UID, which never changes. The emulator E2E proves the Firestore snapshot (profile + Plus/Stripe refs, dogs, documents, QR flag) is byte-identical before and after.

## 3. Migration
No data migration. No backfill. No env change required (feature on by default; kill switch below). Customers opt in one at a time.

## 4. Rollback
- **Feature:** set Vercel env `VITE_IDOGS_EMAIL_PASSWORD_LINK=0` and redeploy, or promote the previous Production deployment (`dpl_36frjBos7fYNSHSpM5fph1PLBzME`, `2da4f0d`). Customers who already added a password simply keep a second sign-in method on the same account; nothing to undo.
- **Rules:** rules are deployed separately (G3 staging → G3P production). Rollback = redeploy the previous `firestore.rules` (live-baseline `2da4f0d` file) with `firebase deploy --only firestore:rules --project <project>`. The web code does not depend on the hardened rules.

## 5. Firestore Rules hardening (code only — NOT published)
- `documents` client updates limited to `name`, `title`, `notes`, `source`. `dogId`, `tenantId`, `filePath`, `fileUrl` and QR-sharing flags remain server-owned (Admin SDK APIs).
- `vaccineRecords`, `wormingRecords`, `healthTests`, `activityNotes`: `dogId`, `tenantId`, `createdBy` immutable from clients (blocks injecting a fake vaccine onto another dog's public QR passport).
- Least-privilege boundaries proven by emulator tests: signed-out, owner, stranger, former breeder, transferred-dog buyer, `admin` custom claim (grants nothing client-side), deleted dog, owner without a profile document, cross-dog create.
- Compatibility: every client write in `src/` was audited (vaccine/health/worming/note edits, document rename) and touches only allowed fields. QR passport, shared documents and Puppy Timeline read through Admin-SDK APIs and are unaffected.

## 6. Gates
- **G6** (web Production) for the exact candidate SHA after staging QA.
- **Firebase Rules gate**: G3 (staging) then G3P (production), separately. Not requested by CI PASS.
