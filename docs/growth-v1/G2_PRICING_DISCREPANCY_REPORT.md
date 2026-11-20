# G2 — Pricing discrepancy report (read-only; no billing, Stripe, voucher or entitlement change made)

Status: DRAFT for Owner G2 decision. Does not block unrelated Growth work. Source: repo at `ae79a0c`+ (production base `04f0f60`). Live Stripe was NOT inspected: no Stripe credentials or connector exist in the build environment, and read-only verification was authorised only "where authorised" — so item 2 below remains BLOCKED until the Owner provides a read-only (restricted) key or confirms the live price in the Stripe dashboard.

## What the code does today (preserved unchanged)
| Offer | Terms in code | Where |
|---|---|---|
| Free | A$0, up to 2 dogs, 2 iDogs Scans lifetime, QR Passport, email reminders | `src/lib/pricingCopy.ts` |
| Gift Voucher | 100 places, 12 months Plus, no card, nothing renews; needs ≥1 dog and no paid plan; claim by 31 Dec 2026 (Adelaide time); then A$7/month incl. GST | `shared/access-grants.js`, launch-offer handler |
| Plus promotion | A$0/month through 31 Jan 2027, then A$7/month incl. GST | `shared/plus-promotion.js` |
| Standard Plus | A$7/month incl. GST (5 dogs, 10 scans/month, litters, Puppy Showcase, 2 litters per rolling 12 months, extra litter A$39; SMS add-on +A$3/month for 20 credits) | `pricingCopy.ts` |
| Annual Plus | A$70/year constant exists; price ID `plus_annual` exists in checkout handler | hidden on landing |

## Discrepancies / risks
1. **Voucher vs promotion are mutually exclusive in code.** While `LAUNCH_OFFER_ENABLED=true`, `/api/offer-status` returns `promotionSuperseded: true` and promotion checkout is disabled (`api/create-checkout.js`). So a new customer can NOT get both. The landing page has a secondary "Prefer a monthly subscription? Get Plus for A$0/month until 31 January 2027" block shown only when voucher AND promotion are both active; under current server logic that state should not occur. RISK: if the flag and the promotion dates ever disagree, the page would present both. Recommend Owner decides: keep the guard, or delete that secondary block. No claim of combinability is made anywhere on the page.
2. **Annual A$70 is unverified against the live Stripe product.** Kept hidden (per Owner). Needs a read-only check of the live price object for `plus_annual` (amount, interval, GST/tax behaviour, active).
3. **Owner brief vs code on promotion wording.** The Owner message describes the promotional terms; the code's promotion ends 31 Jan 2027 and is superseded for new customers while the voucher runs. Owner to confirm which is the intended policy after 31 Dec 2026 (when voucher claims close, the promotion becomes visible again until 31 Jan 2027).
4. **"Most popular" badge** appeared in the design; removed because it is an unverified claim. Replaced by "For more dogs and breeding".
5. **Hero fallback.** If the offer-status API is unreachable, the hero shows "iDogs Plus A$0/month through 31 January 2027" (the promotion) because the voucher state is unknown. This is production's logic. Option: show nothing in that case.
6. **Stale legacy price IDs** (`basic`/`pro`/`kennel` in `LEGACY_PAID_PRICE_IDS`) are not shown on the landing page; no action.

## Owner decisions needed (G2)
- Confirm post-voucher promotion policy (item 3) and whether to delete the secondary block (item 1).
- Authorise a read-only check of live Stripe for annual price (item 2), or confirm it stays hidden.
- Choose hero fallback behaviour (item 5).
