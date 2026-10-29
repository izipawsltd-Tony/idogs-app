# Restore ledger scope and historical provenance — 30 October 2026

## False empty-ledger PASS corrected

The isolated restore assessor previously let the returned ledger define its entire account scope. A self-declared complete empty ledger could therefore return replayVerified:true without inspecting any restored account. An inventory response also had no explicit UID binding.

The assessor now requires a separately supplied, nonempty approved UID/revision scope, bounded to200 unique accounts and copied before awaiting IO. Ledger membership and revisions must match exactly before any inventory reads. Empty, omitted, extra, duplicated, foreign or revised accounts reject the assessment. Inventory responses must identify the requested UID. The ledger is cloned before inspection so a reader's shared mutable object cannot redefine the assessment scope mid-flight. Existing target, retained-content, time, Auth-state, re-read and quarantine checks remain intact.

The controlled-record QA wrapper pins its existing disposable UID/revision1. The historical managed QA continuation pins qa-deleted/revision1 and checks the inspector UID; only compatibility contract tests are run. No completed backup, restore, replay, database cleanup or managed workflow dispatch is repeated.

## Independently fetched historical artifact

scripts/qa/deletion-historical-ledger.mjs is a disabled-by-default, read-only audit reader for the single already completed managed QA artifact. It authenticates through the existing gh CLI without reading/exporting credentials. Requests are restricted to the pinned repository/run/artifact endpoints. It checks successful workflow_dispatch, workflow path, source SHA, repository/fork IDs, artifact name/ID/expiry/branch/size and recorded SHA256, then hashes the actual downloaded ZIP bytes. A bounded single-file ZIP decoder reads only managed-backup-manifest.json in memory and never extracts paths onto disk. The manifest must match the approved QA projects/database names, immutable source/destination UIDs, nonce, exact ledger, replay and cleanup receipts.

Actual read-only GitHub verification succeeded for run40671427781, artifact12809300074, source1fa8549b0f4aa145bdd686bc68f6726d2009eb75, ZIP SHA256 ee52e9b242073636e3f0e161ac0371b49623c3a7c8ba67946853401aa5727c11. This establishes provenance of that historical QA ledger outside the restored databases, without recreating any resource or replaying the rehearsal.

The output explicitly remains historicalOnly:true,freshnessVerified:false,productionReady:false. A genuine old artifact can omit later deletions; it is not a continuously current, complete Production deletion ledger. The audit reader is not wired to activate a restore or account. Replacing independentOfRestore with another caller assertion would not solve this remaining authority/freshness problem.

## Validation and remaining work

Local480/480 Vitest tests PASS, including42 restore-gate cases.24 historical provenance rejection/disabled/transport cases and18 managed continuation contract cases PASS (42 Node tests total). TypeScript and whitespace checks PASS. The initial table-test fixture incorrectly expanded array rows; it was corrected without changing the expected rejections. No provider mutation was used to make the tests pass.

Exact-source CI and real isolated controlled-record replay regression are pending after push. The actual historical artifact read is separate evidence from the mocked rejection tests. A temporary approval usage-limit error initially prevented the GitHub read; after its reset, normal approval permitted the same read-only action. No approval bypass was used.

Next work remains a provenance-backed current ledger/high-watermark and restore-generation quarantine, including Auth imports preserving historical identity facts; guarded signed-authority lifecycle/drain; per-route account resolvers preserving newer puppy/media/Meta behavior; and a post-Auth confirmation outbox without sending messages. No Production, IAM/provider, Privacy/App Review or mobile build change. Original seven-day source/run/job/manifest and deadline remain unchanged.
