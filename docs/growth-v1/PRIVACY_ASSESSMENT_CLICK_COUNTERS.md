# Privacy assessment — homepage click counters (LP-09). Not legal advice.

## Decision taken
Click sending is **OFF** (`LANDING_CLICK_COUNTERS_ENABLED = false` in `src/lib/landingEvents.ts`) until the Owner confirms. Per Owner instruction, non-consented tracking is not expanded until compliance is verified. The existing page-load counter (production, unchanged) keeps running.

## What the counters do (when enabled)
- Browser sends `{path:"/", event}` where event is one of 5 fixed names (`app_store`, `cta_get_started`, `cta_owner`, `cta_breeder`, `cta_voucher`).
- Server increments one number in a per-UTC-day aggregate document `landingStats/<day>.byEvent.<event>`. Closed allow-list; unknown events and other paths are ignored.
- No cookies, local storage, user ID, IP, user agent or any per-person record is stored. Nothing is sent to third parties. Meta Pixel remains consent-only and is not involved.

## Assessment
- Data stored is aggregate and non-identifying, so the stored result is unlikely to be personal information. Open points that need Owner/legal confirmation:
  1. Each click is still an HTTPS request, so the hosting provider's ordinary request logs can see network details. This is the same for the existing load counter and for any page view.
  2. The Privacy Policy section 3 mentions usage data and pages visited, and optional ad measurement, but does not specifically describe anonymous button-click counts. If enabled, add one sentence.
  3. The Australian Privacy Act 1988 and any applicable ePrivacy-style expectations of visitors from other regions were not assessed by a lawyer.
- Compared with consented ad measurement, this is first-party and needs no cookie. It is still not tied to the "Ad privacy choices" control.

## Options for Owner
A. Keep OFF (current). Use Vercel/App Store Connect analytics for outbound click and download numbers.
B. Enable for all visitors after a one-line Privacy Policy addition and legal sign-off.
C. Enable only when the visitor has chosen "Allow ad measurement" (smaller, consent-gated sample).
