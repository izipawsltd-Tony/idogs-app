# Exact dog-path authority — 30 October 2026

The recursive scanner reports the collection ID `dogs` for both `dogs/{id}` and `puppyFollowers/{uid}/dogs/{id}`. Building the ownership map from that collection ID lets the later nested follower overwrite a root dog with the same ID. That can incorrectly preserve an owned dog or, more seriously, plan deletion of a dog and linked records belonging to another current owner.

`buildEmulatorDeletionPlan` now takes dog ownership authority only from the exact root path `dogs/{id}`. Nested dog records cannot replace that authority. Descendants with an exact scoped dog ID in their ancestor root ID or an exact `dogs/{id}` path pair enter conservative review even when their payload contains no identity. Existing unknown/deep-path classification supplies `unclassified_record_review`; no collection name, ownership disposition or deletion permission is added. Prefix collisions do not scope payload-free descendants.

Four additional actual Admin SDK cases in `scripts/test-deletion-production-schema-emulator.mjs` cover:

- An owned root dog shadowed by another account's same-ID follower record: the root ownership disposition stays owned; execution holds.
- A root dog owned by somebody else shadowed by a departing-owner follower record: root and linked document remain retained; execution holds.
- Payload-free descendants below a dog, an orphan puppy profile and another account's same-ID follower: all remain quarantined without destructive staging.
- Another account's descendant IDs that only share a dog-ID prefix: no false exact dog-path match.

The first three invoke the actual deletion processor and verify its held request, empty operation staging, absent receipt and unchanged exact source versions. All fixtures use fresh nonce paths; cleanup checks exact document versions and object generations. The existing five schema cases remain intact. No production, provider, configuration, IAM, secret, original seven-day fixture or managed restore fixture is used.

Preparation verification: both changed JavaScript files pass `node --check`; `git diff --check` passes. Actual emulator cases have **not been run in this track**: the coordinator owns the single emulator process and the combined exact-source CI run. No reduced assertions or simulated result substitutes for that run.

With the coordinator's approved local emulator endpoints, `GCLOUD_PROJECT=demo-idogs-deletion` and `ACCOUNT_DELETION_MODE=prototype-emulator`, run:

```text
node --test --test-concurrency=1 scripts/test-deletion-processor-emulator.mjs scripts/test-deletion-production-schema-emulator.mjs
```

The existing pinned workflow already includes this command and both files. Runtime remains default-disabled and QA-only. This correction does not establish complete inventory, safe descendant dispositions, restored-descendant replay or operational activation readiness.
