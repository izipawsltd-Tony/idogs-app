# Plus promotion email handover

Status: source pack and synthetic review artifacts only. **No campaign, recipients, provider draft, schedule or real email has been created by this change.**

## 1. Invitation

Subject: **iDogs Plus is free until 31 January 2027 🐾**

Review draft copy is rendered by `invitationEmail()` in `scripts/lib/promotion-emails.js`. HTML includes the crossed-out A$7 and A$0 offer. Plain text has the same benefits and material terms. The CTA is the durable authenticated Billing page; it never includes a private Checkout session. Offer date, A$7 inclusive GST renewal, required payment details, automatic renewal, cancellation and SMS/extra-litter exclusions are explicit.

Use **Resend Broadcasts**, not `/api/send-email`, for this promotional campaign. The HTML/text retain the real provider placeholder `{{{RESEND_UNSUBSCRIBE_URL}}}`. It is not a working link in the synthetic preview. Resend must replace and verify it during provider QA. Do not replace it with a fake app URL, mailto or dead placeholder, or reset an existing unsubscribed contact while importing. Do not send to a whole existing segment without reconciling the reviewed audience.

## 2. Seven-day notice

Subject: **Your free iDogs Plus period ends soon — A$7/month from 1 February**

`renewalEmail()` contains the requested HTML/text copy for review. It states 1 February 2027 (Adelaide), A$7/month including GST, saved payment method, automatic continuation, cancellation deadline and a durable Billing link. Billing creates the owner's actual customer-portal session after sign-in; never store expiring portal links in a scheduled email.

**Active sender remains Stripe native.** The prior release verified its “7 days before a trial ends” and manage-subscription-link settings enabled. This pack does not replace Stripe's message with this custom copy, alter Stripe settings, install a scheduler or prove actual delivery. Provider access must establish which content can be customized. If exact custom wording requires an app sender, obtain scoped approval and verify a coordinated replacement before disabling native reminders. Never activate both.

The regular fixed trial end is `2027-01-31T13:30:00Z`, or 1 February 2027 00:00 Adelaide. Seven days earlier is **25 January 2027 00:00 Adelaide**. The final 48-hour waived-partial-period enrollment path has no seven-day free trial; review actual Stripe behavior for late enrollment rather than promise a reminder before registration. Exclude canceled/nonrenewing subscriptions from any future custom sender and recheck current subscription truth immediately before delivery. Initial A$0 Live enrollment PASS does not prove this future email or A$7 renewal charge.

## Offline review commands

```
node scripts/promotion-email-pack.mjs render /absolute/new/private/directory
node scripts/promotion-email-pack.mjs audit /absolute/private/recipient-snapshot.json
npx vitest run scripts/promotion-emails.test.js
```

Rendering refuses to overwrite existing files. Audit prints aggregate counts only, never recipient details. There is no send command and no database/provider connection. Generated outputs, private snapshots and permission evidence must stay outside Git. Preview builds alone expose synthetic HTML at `/__qa/promotion-emails/invitation.html` and `/__qa/promotion-emails/renewal.html`; normal/production builds create neither.

## Audience contract and final send gate

The offline auditor accepts an array of **normalized, privately reviewed snapshots**, not raw Firestore user documents. These are not new database fields or evidence that users already consented:

| Field | Evidence required before marking eligible |
| --- | --- |
| `email`, `emailVerified` | Current verified Auth address; normalize case for duplicate detection |
| `accountActive`, `deletionPending` | Auth exists/enabled; no non-cancelled deletion request |
| `effectivePlan` | `free`; exclude Plus and internal access |
| `currentSubscription` | Verified absent nonterminal Stripe subscription, including past_due/incomplete/paused/unpaid; provider uncertainty stays unknown |
| `promotionPendingOrJoined` | No pending/completed enrollment; avoid promoting a second subscription |
| `qaOrInternal` | Explicit classification from current QA/internal exclusions, not name guessing |
| `marketingPermission`, `permissionEvidence` | `verified` with a reviewed evidence reference; signup/Terms/care reminders alone are insufficient evidence |
| `suppressed` | Verified false against current opt-out, bounce and complaint records; never reset provider unsubscribe state |
| `checkedAt` | UTC ISO verification timestamp at most five minutes old; future/stale/missing is held |

Unknown inputs stay HOLD. All duplicated case-insensitive addresses stay HOLD even when only one row is suppressed. The report is **eligible for owner review**, never a send authorization. No real recipient inventory/count is established yet. Existing super-admin user listing lacks these checks and is not a complete export.

Before any real send: authenticate the correct iDogs Resend workspace; verify sender domain, provider unsubscribe/suppression and actual rendered test email; review a complete private audience with current subscription/deletion checks and explicit send authority. Reconcile suppression again at dispatch, record one approved campaign/Broadcast ID to prevent a second blast, and obtain owner approval for the exact audience/count/content. No purchase or paid activation is authorized by this pack.

References inspected 22 October 2026:
- https://resend.com/docs/dashboard/broadcasts/introduction
- https://resend.com/docs/api-reference/broadcasts/create-broadcast
- https://resend.com/blog/broadcast-api
