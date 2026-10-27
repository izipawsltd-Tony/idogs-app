# Isolated deletion restore replay gate — 28 October 2026

The owner has privately compared and confirmed that the Production Anthropic key belongs to izi’s Individual Org. The authenticated Console shows default input/output retention ON, 30 days. This closes the organization-binding question; no ZDR guarantee, key retrieval or provider configuration change is made.

Added a read-only isolated restore gate. It requires complete deletion history independent of the restored subset, exact tombstone revision/state, absent Auth, complete restored inventory and retained-content hashes. Ongoing deletion, resurrected content, lost tombstones and a ledger changed during inspection keep the copy isolated. The result always says productionReady:false and keepIsolated:true; it is not a release token or a Production restore mechanism.

The existing nonce-scoped cloud QA now captures exactly its disposable user and dog records, completes deletion, restores those two records in the private QA database, verifies the gate blocks them, replays removal with content preconditions and verifies clean readback. The unrelated owner sentinel is checked again. No real account or Production database is targeted. This is a controlled record-restore rehearsal, not verification of a managed Firestore backup restore. No change to the original seven-day Storage fixture/run/deadline.

Local validation: 453 Vitest checks (including16 new restore cases) and34 cloud-scope/provider checks PASS; syntax checks PASS. Cloud result pending. No signed mobile build is requested for this backend QA change. App Store draft now selects owner-PASS build92 and saves the actual Privacy URL; App Privacy is not yet published and no final submission occurred.

## Retention review expiry follow-up

Found a restore-gate gap: matching retained content could pass even after its financial/history retention review expired. The gate now requires a recognized retention category and a meaningful reason/date for reviewed retention, checks expiry after both asynchronous inventories and the final ledger read, and rejects invalid/backwards clocks. Current-owner history retains its separate treatment. Eleven additional regression cases cover expiry at entry and during reads, both review categories, malformed dates, unknown categories and clock failures. Local results: 464 Vitest checks (27 restore checks) and34 cloud/provider scope checks PASS.

For the owner-authorized hourly branch/QA scope, automatic push runs must not send messages. The cloud workflow now omits the Resend QA credential unless a separate manual dispatch explicitly opts into simulation. An explicitly requested simulation still fails when its dedicated credential is absent. Automatic restore QA does not assert email simulation/delivery; prior email evidence remains separate. No provider settings, IAM, real messages or Production state changed.

Prior source672ad945 cloud workflow40588841068/job122487434220 PASS: controlledRecordRestoreBlocked:true, exactRecordReplayVerified:true, cleanupVerified:true, managedBackupRestoreVerified:false, productionReady:false. This supersedes the initial pending cloud-result line above. Original Storage lifecycle run/deadline remains unchanged; no early rerun.
