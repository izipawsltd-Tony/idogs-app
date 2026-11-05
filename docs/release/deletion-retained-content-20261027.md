# Bind retained records to reviewed content

The guarded deletion worker previously exempted an approved retained path from the final identity scan without binding that exemption to the reviewed content. A later privileged write could add departing contact information to that path and still allow completion. A financial review could also expire while the worker waited for storage recovery.

The plan now stores a SHA-256 digest of each retained document's expected content, including the exact planned redactions for shared history. Final inventory requires every retained document to exist and match that digest before Auth removal or confirmation. Financial/history retention decisions must still have a valid future review date at that final check. Changed, missing or unbound retained documents fail closed; expired reviews require operator review. Existing staged plans with retained records and no digest are deliberately not grandfathered or silently replanned after partial deletion. Plans with no retained records are unaffected.

Collection inventory budgets now reject non-integer, non-positive and over-limit values before accessing the database; a malformed budget cannot remove the scan bound.

Regression scenarios cover added contact information in retained financial records and shared history, a review expiring during the seven-day storage wait, and invalid collection budgets. Existing shared-owner preservation and reviewed financial completion cases remain in the emulator suite.

Scope: guarded emulator/isolated-QA engine only. This does not enable Production processing, publish a policy, submit an App Store version or require a new iPhone binary. The existing actual seven-day cloud lifecycle retains its original run and deadline; simulated expiry tests here do not replace that provider check.

Local validation: all 42 real Auth/Firestore/Storage emulator integration tests passed with project `demo-idogs-deletion`; all 68 account-request, billing, runtime, HTTPS, confirmation, email-sink, Stripe-contract and readiness checks passed; TypeScript and whitespace checks passed. No live data or provider mutations were used for these checks.
