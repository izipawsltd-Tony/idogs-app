# Plus A$0 promotion — release review

Implementation campaign: through 31 January 2027 inclusive, Adelaide; monthly A$7 including GST from 1 February, unless cancelled. Existing Plus caps/scan quotas remain; SMS and extra litters remain separately priced. No new global Stripe Price, tax configuration or automatic_tax changes.

## New / unpaid accounts
Hosted Checkout collects payment details and explicit campaign agreement. Reuses the verified A$7 monthly price. Trial end is fixed to Adelaide midnight, not a rolling number of free months. Final 48 hours use a waived initial partial billing period; session expiry precedes the charge anchor. Enrollment closes in the final 32 minutes because Stripe requires at least 30 minutes of session lifetime. Expired/stale claims never silently fall back to immediate payment. Ongoing subscriptions fail closed for review rather than create a duplicate. Former customers with a cleared subscription pointer can reuse their trusted customer after Stripe confirms terminal subscription history; incomplete/paginated history or lookup failure blocks checkout.

Server-only `plusPromotionCheckouts/{uid}` stores a reusable attempt/Checkout result. Existing deny-all Rules protect the new collection; no Rules change. Stripe idempotency keys derive from the persisted attempt, not client data. This is new billing metadata, not a backfill/migration of existing customer records.

## Existing paying customers — required before campaign launch
Do not bulk-set `trial_end`: it would waive the SMS item on shared subscriptions. Do not reset an annual subscription's anchor or cancel/recreate it; preserve prepaid time and cancellation intent.

Prepare a private inventory of each account's verified base Plus price/item, interval, current period, scheduled cancellation, existing discounts/credit and any SMS item. Preview the proposed invoice/adjustment for each account. Apply the campaign only to the Plus item, preserving SMS billing. Annual prepaid value needs an equivalent reviewed credit/extension; no automatic conversion to monthly. Past invoices are not silently refunded. Legacy price holders require explicit review before changing their post-offer rate.

No existing-subscription migration, Stripe live checkout or email campaign has run in this increment. Do not publish copy implying existing customers already have a discount. Owner reviews the private inventory and exact proposed adjustments before live application. Confirm promotional renewal reminder configuration before auto-renewing trials go live.

Read-only inventory during implementation: connected iDogs account has 8 historical subscriptions, all cancelled, none active, no annual subscription and no subscription schedule. Thus no active paid subscription adjustment is proposed from this snapshot. Recheck at launch; this is not proof of Firebase profile classification or marketing eligibility. Active catalog has verified iDogs Plus A$7/month and A$70/year; stale source IDs were corrected for new Checkout, with older Plus IDs retained for recognition. Connected tool exposes only live mode; sandbox/staging price mapping remains a real test-access blocker. No live Stripe mutation performed.

Preview guard: the existing staging monthly test Price is selected only with the exact staging Vercel project, staging Firebase and a test-mode key; other Preview environments cannot create promotional Checkout. Production requires a live key. Test-mode annual selection is intentionally not configured here. No env value or Stripe object was changed. End-to-end testing still needs usable staged auth/browser and provider test access; guard configuration is not a successful payment test.

## Invitation email draft (not sent)
Audience: registered accounts verified to have no current paid subscription; exclude deleted/pending-deletion accounts, duplicates, opted-out marketing recipients and undeliverable addresses. Recheck subscription state at send time. No recipient list or customer information goes in Git.

Subject: Enjoy iDogs Plus for A$0/month through January

You already have an iDogs account. Now you can enjoy Plus for A$0/month through 31 January 2027.

Keep your dog profiles, health records and breeding records organised, with the existing Plus limits and features.

Normally A$7/month. A$0/month through 31 January 2027 (Adelaide time), then A$7/month from 1 February 2027, including GST. Payment details are required. Your subscription renews automatically unless cancelled before renewal. SMS and extra litters are charged separately.

Sign in to iDogs and open Billing to view the offer and choose whether to join.

CTA: View my Plus offer

Include the existing verified marketing unsubscribe mechanism and business footer. Do not send using a transactional-only opt-in or without a reviewed eligible recipient list.

## Technical evidence boundaries
Mocks verify request construction/consent/date behavior; they do not prove Stripe accepts a session, issues a zero invoice or charges the intended renewal. Required sandbox journey: accept offer -> payment details -> zero initial payment -> trusted webhook -> Plus entitlement -> renewal/cancellation through test clock. Final 48h branch needs its own sandbox case. Real browser QA and these provider checks must be reported separately from unit tests.

Official references:
- https://docs.stripe.com/payments/checkout/free-trials?payment-ui=stripe-hosted
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/payments/checkout/billing-cycle.md?payment-ui=stripe-hosted
