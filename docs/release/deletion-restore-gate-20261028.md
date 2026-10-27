# Isolated deletion restore replay gate — 28 October 2026

The owner has privately compared and confirmed that the Production Anthropic key belongs to izi’s Individual Org. The authenticated Console shows default input/output retention ON, 30 days. This closes the organization-binding question; no ZDR guarantee, key retrieval or provider configuration change is made.

Added a read-only isolated restore gate. It requires complete deletion history independent of the restored subset, exact tombstone revision/state, absent Auth, complete restored inventory and retained-content hashes. Ongoing deletion, resurrected content, lost tombstones and a ledger changed during inspection keep the copy isolated. The result always says productionReady:false and keepIsolated:true; it is not a release token or a Production restore mechanism.

The existing nonce-scoped cloud QA now captures exactly its disposable user and dog records, completes deletion, restores those two records in the private QA database, verifies the gate blocks them, replays removal with content preconditions and verifies clean readback. The unrelated owner sentinel is checked again. No real account or Production database is targeted. This is a controlled record-restore rehearsal, not verification of a managed Firestore backup restore. No change to the original seven-day Storage fixture/run/deadline.

Local validation: 453 Vitest checks (including16 new restore cases) and34 cloud-scope/provider checks PASS; syntax checks PASS. Cloud result pending. No signed mobile build is requested for this backend QA change. App Store draft now selects owner-PASS build92 and saves the actual Privacy URL; App Privacy is not yet published and no final submission occurred.
