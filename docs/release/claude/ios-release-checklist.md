# iDogs iOS 1.0 — release checklist (App Store + physical iPhone QA)
Prepared 01 Nov 2026 by Claude. Builds on `docs/release/app-store-preflight-20261030.md` (read-only ASC evidence, runs 40955343472 / 40975496344) — that evidence is referenced, not re-claimed. Status key: ✅ verified with evidence · ⏳ to do · 🔒 Owner Gate.

## A. Candidate & build (iOS line)
| # | Item | Status | Evidence / action |
|---|---|---|---|
| A1 | Integrated iOS candidate = PR #67 head (+ automation #72 when reviewed) | ⏳ | Current #67 head `124f37d`; CI ✅ run 41286858500 incl. unsigned simulator compile |
| A2 | Unit/emulator regression on candidate | ✅ | 505 unit tests; phone→email emulator; rules emulator 21/21 |
| A3 | Native production env guard (`npm run test:native-release-env`) runs in TestFlight workflow before signing | ✅ (source) | `mobile-ios-testflight.yml` step "Verify native production environment guard" |
| A4 | Signed TestFlight upload of the exact candidate SHA | 🔒 G4 | Dispatch `mobile-ios-testflight.yml` on the candidate branch; job waits in Environment `testflight` once reviewer configured. Build number = workflow run number |
| A5 | ASC processing VALID + build selected for 1.0 | ⏳ after A4 | GET-only `mobile-ios-store-readiness.yml`; selecting a new build replaces Owner-PASS build 92 → needs G5 PASS first |

## B. Physical iPhone QA script (Gate G5 — Owner on device, TestFlight build from A4)
Use the protected review/demo account or a staging-free test account on **Production** backend (TestFlight builds use Production). Do not use real customer accounts. Record PASS/FAIL per step on #69.
1. Fresh install → app opens at Login; status bar legible; no web-browser chrome.
2. Login with email/password → Dashboard. Sign out → Login. Forgot password → reset email received → new password works.
3. SMS-signup customer guidance text visible on Login (web Settings flow is the path; no external link).
4. Registration (new disposable email) → verification email → "I've verified" continues to Dashboard.
5. Dogs: list loads; open a dog; edit a field; save persists after app restart.
6. Documents / iDogs Scan: the picker offers **Take Photo, Photo Library and Files** (fixed in `b74d6d2`; previously camera-only) → upload a photo (incl. HEIC), a library image and a **PDF** → permission prompts show the iDogs purpose strings → upload succeeds → **View** opens file → **Edit** rename shows new name → **Delete** asks and removes.
7. Dog Detail → Documents tab: View → Edit → Delete row fits the screen (no horizontal scroll).
8. QR Passport: open passport; public link opens in a signed-out browser and shows no private notes.
9. Plus: an account with Plus shows **Current plan: Plus** and features; **no prices, checkout, A$0 offer, "Upgrade" links or Manage subscription** anywhere in the app (Billing, sidebar, dog limit, litters, landing).
10. iDogs Scan: consent screen before upload; manual-entry alternative available; result applies to the dog.
10b. Litters (breeder): puppy media → **Take Video** shows the microphone permission prompt and does **not crash** (purpose string added in `b74d6d2`); a library video uploads.
11. Reminders/notifications screens open without error; Settings opens; account deletion initiation/status visible (do not complete deletion on the shared demo account).
12. Background → foreground after 10 min: session retained, no blank screen; rotate/keyboard does not break layout.
13. Airplane mode: friendly error, no crash; back online recovers.

## C. App Store Connect metadata & compliance
| # | Item | Status | Evidence / action |
|---|---|---|---|
| C1 | App identity, bundle, en-AU | ✅ | Preflight run 40955343472 |
| C2 | AU-only availability, new territories off, free download, AUS rating 18+ | ✅ | Run 40975496344 |
| C3 | Release mode AFTER_APPROVAL (auto-public on approval) | ⚠️ decision | Owner to confirm or switch to manual release before G7 |
| C4 | Screenshots 6.1"/5.8" × 4 COMPLETE | ✅ delivery / ⏳ content | Visual check of each image vs the candidate's real screens (no real customer data) |
| C5 | Description, keywords, support/marketing/privacy URLs present | ✅ presence / ⏳ content | Read exact text; ensure no mention of in-app purchasing or web pricing (anti-steering) |
| C6 | Reviewer contact + demo credentials + notes | ✅ configured / ⏳ verify | Verify demo login on the selected build (B2). Notes must state: digital Plus is not sold in the app; web-purchased Plus works in-app (3.1.3(b)); deletion behaviour described truthfully |
| C7 | **App Privacy labels** | ⏳ 🔒 portal | Reconcile with actual flows: Contact Info (email, name; phone for SMS sign-in on web only — confirm whether the iOS app collects phone), User Content (photos/documents; **puppy videos incl. audio** — declare Audio Data / Photos or Videos), Identifiers (Firebase UID), Purchases (plan status only), Diagnostics if any. All **linked to identity**, **not used for tracking** (✅ source: iOS line contains no Meta pixel / ads code). Third-party processors: Firebase/Google, Vercel, Anthropic (document scans, 30-day retention, overseas processing), Resend email |
| C8 | **Effective Privacy Policy** | ⏳ 🔒 Owner/legal | Release `PrivacyPage` still shows the draft review notice; prior audit found cookie/deletion contradictions. Publish an effective policy matching C7 before submission. "Asia-Pacific" storage wording per CLAUDE.md |
| C9 | Export compliance | ✅ | usesNonExemptEncryption:false on builds 92/93 |
| C10 | Account deletion in-app (Guideline 5.1.1(v)) | ⏳ | Initiation present; confirm the deletion request is actually fulfilled operationally (handoff: live fulfilment worker not yet active) — **potential rejection risk** |
| C11 | Sign in with Apple requirement (4.8) | ✅ N/A (source) | iOS line has no Google/OAuth sign-in code (no GoogleAuthProvider / signInWithPopup / OAuthProvider in `src`); email/password only |
| C12 | Paid agreements / banking | ⏳ portal | Only needed if IAP added later; free app needs the Free Apps agreement accepted |

## D. Billing policy decision (Objective 2.6)
- Plus is a digital subscription → selling it **inside** the iOS app requires Apple In-App Purchase (Guideline 3.1.1). App is AU-only, so the US-storefront external-link allowance does not apply.
- Current approach (no purchase, price or steering in the app; web-purchased Plus usable in-app) is the compliant path for 1.0 — **verified at source level** (`nativeBillingRender` tests, native fences); confirm on device (B9).
- Adding StoreKit IAP later is an Owner product/financial decision (Apple commission, separate entitlement sync) — not required for 1.0.

## E. Blocking items before G7 (submission)
1. G4 TestFlight of the candidate → G5 physical QA PASS (section B).
2. C7 + C8 Privacy labels and effective policy (Owner/legal).
3. C10 deletion fulfilment truthfully operational or reviewer notes accurate.
4. C3 release-mode decision.
5. Production web (G6) compatible with the iOS candidate's API usage (native builds call Production `/api/*`).
