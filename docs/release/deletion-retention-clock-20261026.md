# Actual seven-day retention lifecycle started

Owner approved the additional private bucket and controlled synthetic lifecycle QA on 26 October 2026. Bucket provisioning workflow 40246113872 passed at source 671c0ac487748eed85aed9f05027fe3c37aa5001. Existing buckets/policies were verified unchanged.

Actual lifecycle workflow 40271208201, job 121405052447, source e8dc2b1471397885502c7c13389d73f038813a70 completed its initial run successfully with `waiting_for_cloud_expiry`. This is explicitly **not** actual seven-day lifecycle PASS.

Cloud evidence: initial deletion held completion; a soft-deleted generation was restored and its exact synthetic bytes verified; the real shared worker refused completion while the restored live copy existed; the restored generation was deleted again using its generation precondition. Two recoverable generations remain. Auth is disabled and completion/confirmation is withheld. Both actual softDeleteTime/hardDeleteTime values are stored in the durable session manifest in named QA database idogs-deletion-qa.

The final provider deadline is **2026-11-02T04:56:11.242Z**, or **2 November 2026, 15:26:11 Australia/Adelaide**. A successful automation creation schedules the follow-up from 16:00 Adelaide that day, daily for up to seven checks, stopping on PASS. It must rerun the retention job in the same run/source, preserving GITHUB_RUN_ID and manifest. A new workflow dispatch would create another fixture and is not the continuation.

The final check requires bounded soft-deleted inventory empty, exact known generation normal and soft reads returning 404, no live file, then actual shared-worker Auth removal and a QA ledger completion receipt. It cannot substitute a simulated clock or timer for provider readback. No human email delivery, Production deletion or App Store readiness is asserted.

Regression evidence: zero-retention cloud workflow 40271208165 passed again (33 scope/provider checks, 38 emulator integration tests, actual Firebase/Stripe Test deletion and cleanup). Both CI runs on that source passed. Prepared protected HTTPS request QA source 5ef03a1df4fbf60005f35e202f5fef8a9c9f1d73 also passed both CI runs 40271601587/40271596442 and emulator workflow 40271596415. The protected HTTPS request session is prepared within ongoing staging QA authorization; scope and mandatory cleanup are recorded in deletion-public-https-proposal-20261026.md.
