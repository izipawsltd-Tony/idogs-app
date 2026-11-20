# Privacy assessment — homepage click counters (LP-09). Not legal advice.

## Owner decision (20 Nov 2026): Option C — consent-gated
A click is counted ONLY when the visitor has chosen "Allow ad measurement" (same "Ad privacy choices" control as Meta Pixel), on the website, on `/`. No choice, Decline, native app, or any other page → nothing is sent. No non-consented marketing tracking was added.

## Implementation (`src/lib/landingEvents.ts`)
- Gate: `isMarketingWebsitePage() && readMetaConsent() === 'granted' && pathname === '/'`.
- Payload: `{path:"/", event}`, event from a closed list of 5 names; server increments `landingStats/<UTC day>.byEvent.<event>`. No cookies, local-storage writes, user ID, IP, user agent, or third party. Unknown events/paths are ignored server-side.
- The server cannot verify consent (the data is anonymous by design); the gate is client-side.

## Verification evidence
- Unit (`src/lib/landingEvents.test.ts`): undecided → nothing; Decline → nothing; Allow → one beacon on `/`; Allow on `/signup` → nothing.
- Real browser (`e2e/local/landing-clicks-consent.spec.ts`, iPhone 390): before choice → 0 requests; after Decline → 0 requests; after Allow → exactly 1 request, event `app_store`.
- Existing consent suite (pill never covers CTAs, dialog on-screen at 320×568, Pixel never loads before Allow, Decline persists): pass on all 6 projects.

## Policy and UI disclosure (wording NOT legally reviewed)
- `src/pages/PrivacyPage.tsx`: new paragraph "Home page button counts (first-party, only if you allow ad measurement)" and "Last updated" changed to 20 November 2026. The paragraph also discloses the pre-existing anonymous home/signup page-load count.
- Consent dialog: one short sentence added ("We also count home page button taps in anonymous daily totals (not shared with Meta)"). Kept short so the Allow/Decline buttons stay on-screen at 320×568.

## Discrepancies to report
1. The pre-existing page-load counter (`/api/landing-beacon`, production) is NOT consent-gated. It was not changed or expanded; it is now disclosed in the policy. Owner/legal to confirm that is acceptable or gate it too.
2. The Terms/Privacy "© 2026" lines remain (see `LEGAL_FOOTER_VERIFICATION.md`).
3. The dialog's primary heading/label is still "Allow ad measurement"; a visitor allowing it also enables first-party counts. Disclosed in both places.
