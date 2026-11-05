# Consolidated candidate checkpoint — 27 October 2026

Candidate binary: TestFlight 1.0 (86), source 478e5de86b35f586fffcb2eed96c12f395b86493.

Actual fixes and browser/local validation: docs/release/ios-consolidated-20261027.md. This replaces the repeated unchanged-build process with one consolidated binary. Do not request another binary unless application changes or a build failure require it.

Exact-source PR CI 40408028741: SUCCESS. Unsigned simulator and iPhone compilation workflow 40408024975, job 121870719129: SUCCESS. Signed workflow 40408025183, job 121870718916: tests, archive/export, signed identity validation and Apple upload PASS; processing and verified internal tester assignment are still running at this immutable checkpoint. Check the signed run's final conclusion before claiming availability. Device QA of 86 is pending.

This documentation checkpoint intentionally matches the existing GET-only App Store inventory workflow. It does not request another signed build, mutate App Store metadata, select a submission build, submit for review or publish anything. Inspect the allowlisted inventory for current privacy URL, screenshots, reviewer-field presence and selected-build state. Actual reviewer login, privacy-label/legal review and screenshot content still require separate verification.

Owner/release gates are consolidated in docs/release/ios-consolidated-20261027.md. Preserve original retention run 40271208201 and actual expiry 2 November 2026 15:26:11 Adelaide; no replacement fixture or human email. No merge, Production deployment/backend activation or public release.
