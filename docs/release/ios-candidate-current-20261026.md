# Current iOS candidate — 26 October 2026

Baseline re-read: 7fad7e13d1c6cc6db291cd56a3a5de826e499df9, PR #62 draft/open. Its iDogs CI run 40305843419 passed. Owner confirmation of the single deletion QA email is already recorded; no additional email is authorized.

Candidate build source: de07af013ca3969bb0683a885df7ff87bcac0d9e. This updates only the unsigned iOS workflow path filters to cover shared application code and native production environment guard changes, and requests a new signed internal TestFlight candidate using existing signing configuration. Build/upload results are verified below. The owner subsequently reported physical-device QA PASS for TestFlight 1.0(77) in this chat on 26 October 2026; this supersedes Build 43 as the latest owner-confirmed candidate for the requested device checklist.

This documentation commit refreshes the existing GET-only App Store Connect inventory. It does not select a submission build, publish privacy disclosures, submit App Review, merge the PR, or activate/deploy Production changes.

Preserved gates: Production deployment and mutations require separate approval; no real subscription cancellation or additional human email/SMS. Seven-day QA must resume the original run 40271208201 after actual provider expiry, preserving its durable manifest; no replacement fixture. Final expiry is 2 November 2026 at 15:26:11 Adelaide and follow-up begins at 16:00. The initial green run is not lifecycle PASS.

Outstanding engineering and evidence remain as documented in the handoff: production ingress/upload/provider/restore safeguards, effective policy and privacy reconciliation, screenshots and independent reviewer login QA. No App Store readiness is asserted.

## Verified candidate results

Signed TestFlight 1.0(77), source de07af013ca3969bb0683a885df7ff87bcac0d9e: run 40306283996 / job 121516080912 SUCCESS. Signed IPA identity validation passed; Apple upload succeeded without errors; VALID processing and actual internal tester build relationship were verified (one existing tester). Signed IPA evidence was uploaded. Unsigned simulator and iPhone ARM64 compilation: run 40306284010 SUCCESS.

Documentation HEAD feebf725f12d12fccb7895cf3df2acade740f088 CI run 40306361357 SUCCESS: 383 Vitest tests, 69 Node regressions, TypeScript and Vite build. Earlier candidate PR CI 40306289256 was superseded/cancelled; it is not recorded as SUCCESS.

Fresh GET-only inventory run 40306353627 confirmed missing Privacy Policy URL, no screenshots and no selected submission build; reviewer contact/credentials are configured but actual login remains unverified. This inventory preceded build 77 processing and lists only the latest five builds, with pagination explicitly incomplete.

## Owner-confirmed physical iPhone QA — PASS

The owner replied “kết quả PASS” to the requested TestFlight 1.0(77) checklist: login/relaunch persistence, Settings/current plan, native purchase gates, current-owner dog/history/media privacy and accurate deletion request/status wording. This is owner-reported physical-device evidence, not an automated device test. Device model and iOS version were not supplied. No additional screenshot, real-account deletion, live billing change or email/SMS is implied. Independent App Review demo-login QA, screenshots, effective policy and operational deletion safeguards remain open. Production deployment and App Review submission still require their separate gates.
