# Isolated request-policy backend — production deployment review

Prepared on the freshly observed production source `8941cff8737140c024f35e8bde115107fa84cc4c`, Vercel deployment `dpl_Fe5XxYFrDzhw2hNXL7MxLLwHKHkw`, READY at inspection. Recheck the live production SHA before deployment; do not replace unrelated changes from another thread.

## Runtime changes only

Three backend library files differ from that production source:

- `api/_lib/account-deletion-policy.js`: owner-approved policy constants and allowlisted public status.
- `api/_lib/account-deletion.js`: accepted/target/next-update timestamps plus one disabled renewal task atomically with a new request; stable duplicate receipts and cancellation preserving accepted renewal work.
- `api/_lib/account-deletion-inventory.js`: discover renewal tasks as workflow records requiring retention review, plus the previously reviewed private reminder-delivery inventory metadata.

No frontend, effective Privacy/Terms, Rules, Storage, environment, Stripe/Resend/SMS configuration or deployed scheduler changes. No permanent processing, provider cancellation, refunds, charges, invitations or real-data destructive QA. The new top-level collection is server-owned and direct reads/writes remain denied by the unchanged Rules in emulator tests.

## Candidate evidence

Local tests on this production-based candidate: 158 Vitest checks, 16 Node request/inventory checks and eight Auth/Firestore emulator integration checks passed. TypeScript/Vite build passed with existing chunk-size warnings. The broader isolated rehearsal source `a1531caae3fe9b4d5309d43be6086b6fe2ee68d1` also passed CI `39515584851` and ledger run `39515584908`; those results are not substituted for this candidate's cloud checks.

Production deployment requires separate owner approval of the exact tested SHA after CI and Preview verification. Deployment would start persisting targets and disabled tasks for newly accepted requests. It would not fulfil or activate automatic renewal cancellation, permanent deletion or the full seven-day operating commitment. User-visible billing stays pending until a separately tested and approved provider worker supplies real readback.

## Verification and rollback

After an approved deployment, verify deployment identity and unauthenticated request rejection without creating a deletion request on Tony's account. Keep existing request data and disabled tasks; no cleanup or migration is authorized. If rollback is required, restore the previously observed deployment after rechecking current production. Rollback must not purge the new task collection or claim any pending task was fulfilled.
