# Account deletion prototype — emulator scope

Owner authorized backend, UI and Firestore Rules changes on a separate branch with synthetic/emulator data only. No production deployment, real provider calls, real user deletion or App Store submission is included.

## Implemented

- A trusted operator route processes a request revision only after matching local Auth, Firestore and Storage emulator identities, a demo project and explicit prototype opt-in are verified. It refuses cloud credentials and live provider adapters.
- Server-owned deletion locks and writer leases drain active mutations. Client Rules deny a locked actor's writes and control-document forgery. Anonymous scan creation has a bounded schema and checks the current owner's lock.
- Bounded, paginated inventory includes orphaned subcollections. Unknown records, uncertain ownership, transfers, unexpired upload grants and unreviewed financial retention hold processing before destructive operations.
- A durable plan uses document versions, media generations, worker epochs, operation hashes and receipts. Retries resume verified operations. Auth removal and synthetic confirmation precede completion.
- Former-owner deletion preserves the current owner's veterinary history and media; only proven departing identity fields are redacted. Ambiguous shared data holds for review.
- User status distinguishes checking, waiting, review, removal, verification and completion. The operator action is visible only when the server advertises emulator processing.

## Verification

Run `npm test`, `npm run build`, `node --test scripts/test-account-deletion.mjs` and the synthetic workflow `.github/workflows/deletion-processor-prototype.yml`. The integration script uses `demo-idogs-deletion` with all three emulators and no cloud credentials. Its cases exercise actual emulator Auth, Firestore Rules, Storage, request HTTP endpoints and injected failure/retry paths.

## Review findings and release limits

- This is a prototype, not a production deletion service. No live Stripe cancellation, email delivery, backup purge, restore replay or provider retention verification has occurred. Those acknowledgements are synthetic fixtures; they must never be described as real evidence.
- The generic API fences are enabled only in prototype mode. Their conservative scope resolver and global handling for anonymous/provider writers require a separately reviewed, scalable per-route cloud implementation. Secondary resource relationships and detached background writes need further review before activation.
- Direct Storage ingestion is not fenced by Firestore Rules. The worker holds unexpired signed grants and requires synthetic ingress-drained evidence; real upload draining and Storage rules remain production prerequisites.
- Inventory limits hold rather than truncate silently. Root collection listing and missing-parent discovery are emulator prototypes, not a demonstrated production-scale inventory strategy.
- Financial/history retention decisions need exact versions, reasons and future review dates. Real legal retention periods, access restrictions, policy text and deletion of expired retained records remain unresolved.
- The final residual scan checks UID references. Full free-text/email detection, external copies, logs, backups and restored-data suppression require additional engineering and real provider evidence.
- A crashed writer lease stays active and requires operator investigation; elapsed time never proves that an external write stopped.
- Source review and automated tests are not an independent security review. Rules and production architecture require review before broad sharing or any deployment. No production readiness or App Store readiness is asserted.

The existing release build remains 1.0 (42). A successful web build or emulator run does not create a new signed iOS build, replace the App Store build, publish privacy disclosures or submit for review.
