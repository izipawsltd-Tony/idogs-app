# Current iOS candidate — 26 October 2026

Baseline re-read: 7fad7e13d1c6cc6db291cd56a3a5de826e499df9, PR #62 draft/open. Its iDogs CI run 40305843419 passed. Owner confirmation of the single deletion QA email is already recorded; no additional email is authorized.

Candidate build source: de07af013ca3969bb0683a885df7ff87bcac0d9e. This updates only the unsigned iOS workflow path filters to cover shared application code and native production environment guard changes, and requests a new signed internal TestFlight candidate using existing signing configuration. Build/upload/device QA outcomes are pending and must be read back from Actions and App Store Connect; Build 43 remains the last owner-confirmed physical-device PASS until superseded by actual evidence.

This documentation commit refreshes the existing GET-only App Store Connect inventory. It does not select a submission build, publish privacy disclosures, submit App Review, merge the PR, or activate/deploy Production changes.

Preserved gates: Production deployment and mutations require separate approval; no real subscription cancellation or additional human email/SMS. Seven-day QA must resume the original run 40271208201 after actual provider expiry, preserving its durable manifest; no replacement fixture. Final expiry is 2 November 2026 at 15:26:11 Adelaide and follow-up begins at 16:00. The initial green run is not lifecycle PASS.

Outstanding engineering and evidence remain as documented in the handoff: production ingress/upload/provider/restore safeguards, effective policy and privacy reconciliation, screenshots, reviewer login QA and final signed device QA. No App Store readiness is asserted.
