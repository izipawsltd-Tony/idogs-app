# Consolidated iPhone candidate — 27 October 2026

## Problem and resulting behaviour

Owner requested consolidated implementation and a single final candidate after repeated documentation-only builds 82–85. Build 84 installation and functional acceptance were owner-confirmed PASS; build 85 device QA has not been reported.

This candidate contains actual application fixes:

- iOS `.main-area` uses horizontal clipping without creating an implicit vertical scroll container. This restores viewport-relative sticky header behaviour when scrolling profile/care/QR content.
- A fixed white iOS safe-area band prevents scrolled content painting behind the system status region. The existing dynamic safe-area inset controls its height.
- Capacitor SystemBars uses LIGHT (dark icons on a light background) for iOS builds; Android retains DARK for its existing green band. Reference: https://next.capacitorjs.com/docs/apis/system-bars .
- Long dog profile names wrap at 22px on narrow native iOS screens instead of being permanently truncated. Web, Android and desktop typography are preserved.

Vaccination status is intentionally unchanged: a recorded vaccination with no next-due date does not establish current coverage. QR generation/contents are unchanged; full-code access remains available by scrolling.

## Validation before the one signed build

- 383 Vitest tests across 48 files PASS.
- TypeScript check PASS; Vite production build PASS (existing bundle-size warning).
- 23 account-deletion/native-production-environment regression checks PASS.
- Whitespace validation PASS.
- Browser layout fixture used actual source styles and synthetic dog/header/QR markup, with simulated 47px top and 34px bottom safe areas. It did not authenticate or access real data.
- At widths 320/375/414, the long heading's scroll width equalled its client width (198/253/292px): wrapping without horizontal text clipping. Page width stayed within viewport.
- At 375x812 after scrolling 893px, topbar remained at y=0, QR bounds were y=212–509 and bottom navigation began at y=710. The whole QR remained visible between navigation bars.
- Android retained its green status band and nowrap title. Web retained no native band and nowrap title. These are scope checks, not full Android/web functional QA.

Browser fixture geometry does not establish real iOS status-icon appearance or WKWebView behaviour. One consolidated physical-iPhone pass is required on the resulting binary: scroll profile/care/QR, read a long name, check clock/status contrast, scan a complete QR, and smoke-test login/relaunch/Settings.

## Remaining owner/release gates, consolidated

1. Final candidate physical-iPhone QA, device model/iOS version.
2. Public screenshot assets: supplied PNGs are 1125x2436, while the last inspected selected iPhone class accepted 1179x2556 or 1206x2622. Confirm all depicted data are permitted demo/synthetic records and capture originals in an accepted class (or verify another supported class directly in App Store Connect). Do not stretch screenshots as native-device evidence or publish real identifiers. Updated complete QR screenshot is IMG_7876.
3. Confirm the exact reviewer account saved in App Store Connect works with sample data, without owner OTP. Never put credentials into chat/repository.
4. Effective policy/privacy and Production deletion safeguards need separate reconciliation/approval. Current portal record has no effective Privacy Policy URL; unpublished drafts are not effective policy.
5. Original seven-day retention lifecycle QA cannot be completed early: original run 40271208201, provider expiry 2 November 2026 15:26:11 Adelaide; preserve original manifest and existing follow-up. No new fixture or email.
6. Resolve intended Mac availability (existing enabled, Mac QA unestablished) before submission. App Review/public release and Production deployment remain separate owner approvals.

No merge, Production deployment, backend activation, real deletion/cancellation/messaging, policy publication, App Review submission or public release is included in this candidate. Do not create further unchanged binaries after this candidate.
