# iOS Settings: Current plan

Candidate: `f2d563298b818de78dae9d72e5c9457cce2063b0`.

## Result

Settings now exposes a Current plan card and View plan details link. It displays effective Free/Plus access using the existing entitlement resolver instead of the raw legacy plan field (such as kennel). Active granted access is labelled Included access; an unavailable profile is labelled unavailable rather than Free. The details page uses the same effective-plan fallback and does not invent a Monthly interval when none is known.

The missing Billing entry was caused by native polish CSS hiding every link to `/app/billing` on mobile. The rule now targets only the compact top bar. The Settings link is visible; BillingPage and native API routing continue to enforce the external-payment gate.

The card displays existing dog/scan limits and explains read-only excess dogs. No billing configuration, entitlement record, Firebase rule, environment, external message, purchase or live transfer was changed.

## Verification

- 133 unit/component tests passed, including 7 new cases for Free, Plus, active/expired grants, unavailable profile, Settings-to-details navigation and CSS visibility scope.
- Native invoice and exhausted-litter purchase regressions remain green for iOS/Android, with web purchase controls preserved.
- 4 native environment guards passed; TypeScript/Vite production build and whitespace checks passed.
- 4 isolated component QA cases passed: Settings profile edit/save and logout, public passport, Litters/Activity empty-account rendering.
- Existing billing navigation and Settings role-gating structural suites passed (13 and 32 checks).
- React review: existing entitlement helpers reused; no extra requests/listeners added; no change to profile save handlers; accessible section heading and 44px plan-details link.

GitHub runs:

- TestFlight: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39173636771
- CI: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39173641286
- iOS simulator/device compilation: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39173636859

## Device evidence and remaining gate

Tony confirmed the previous Build 17 version, Settings access, profile save and logout/login passed on iPhone in this conversation. This is owner-reported device evidence, not new-candidate device QA.

The new card's installed-iPhone visual/interactivity verification remains open. Source/component tests and successful compilation do not establish a native device PASS. QR handoff, native billing interaction and cold-launch regression remain open unless separately evidenced. PR #25 stays draft; merge and public release require owner approval.
