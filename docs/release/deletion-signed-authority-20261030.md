# Signed upload authority safety — 30 October 2026

## Observed false-drain path

The emulator route wrapper closed its mutation lease in `finally` for every handler, including request-showcase-media-upload and request-landing-media-upload. Those handlers can issue a ten-minute Storage write URL. Returning from the handler, or throwing after signing, is not evidence that the external authority and its in-flight requests have drained. A grant marked rejected/expired and an object currently absent are likewise insufficient. The old wrapper could therefore let the destructive worker proceed without this evidence.

The wrapper now retains the original durable lease for both write-authority issuer routes. The lease is created transactionally before handler execution under the existing authenticated account/dog scope and deletion-lock check. It remains active after return, early return or error. There is deliberately no elapsed-time release, grant-status override, caller release flag or cleanup workaround. A later request after the worker installs its deletion lock is rejected before handler IO and does not create a replacement lease. All changes remain behind the original emulator-only runtime; ordinary deployments still call the unchanged handler directly.

This is a conservative correction of a false closure, not a completed signed-authority protocol. Read-only URL issuers are not classified as write issuers. Confirmation and cleanup cannot close the original issuance lease. A future protocol needs immutable grant/path/identity binding, actual signer outcome handling, provider authorization expiry/in-flight drain evidence and guarded terminal receipts before it can release this hold. No live signer or new credentials are introduced here. No claim of signed URL minting/expiry enforcement by the emulator is made.

## Validation

Four real Auth/Firestore/Storage emulator cases cover both issuer routes returning and throwing. Each writes an actual synthetic grant document carrying expired application status, then invokes the real destructive processor. Processing must return held/active_mutations, preserve the exact original lease, dog and Storage object, leave Auth enabled, record waiting_for_writes, and reject another issuer invocation after the deletion lock. These handlers are controlled contract fixtures, not fake positive signing or drain receipts. Existing ordinary failed-handler lease behavior is checked separately. Final exact-source validation will be recorded after verification.

Local full93/93 real-emulator regressions PASS after the runtime fix. Ten Node cloud-runtime/HTTP guard tests, TypeScript and syntax/whitespace checks PASS. Final focused5/5 authority cases PASS with the stronger Auth/data-preservation and locked-reentry assertions. These are local results; exact-source CI/cloud regression is pending.

No Production route was replaced, no signing/provider settings changed, no cloud resource created, no messages sent and no original seven-day fixture accessed. Existing managed backup and fixture recoveries remain completed. productionReady:false.

## Remaining work

Continue guarded signed-authority issuance/confirmation with real drain evidence, per-route ownership resolvers and independent restore quarantine/ledger (including Auth imports preserving historical identity attributes), then a post-Auth confirmation outbox without sending messages. Preserve newer Production puppy-update/media/Meta semantics; unknown puppyProfiles descendants remain quarantined pending ownership/preservation/replay tests. Do not release these conservative holds merely to make deletion pass.
