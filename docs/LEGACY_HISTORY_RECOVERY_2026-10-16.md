# Legacy transfer history recovery

Older transfers with no ownership snapshot currently display audit activity only. This change restores a read-only section-based profile after an explicitly prepared partial-history backfill. Existing complete snapshots and the current owner's workspace retain their loaders.

## Evidence and privacy

- A caller-owned transfer audit event establishes the dog, former owner and cutoff. Current profile fields are never substituted for missing historical identity fields.
- Only child documents whose server create/update timestamps are no later than the transfer cutoff are eligible. Clinical dates are not used for authorization. Timestamp comparison retains nanosecond precision.
- Media must be under the exact former-owner/dog Storage namespace and unchanged since before transfer. Its generation is saved. Historical signing requires snapshot ownership and exact generation membership; an overwrite cannot expose its replacement.
- Mutable media/document links are stripped from recovered records. The Photos section uses the generation-scoped signer. Missing records are described as unavailable historical data, not confirmed zero records.
- Recovery is a separate backfill. The history endpoint never falls back to querying the buyer's live collections.

## Preparation and application

`scripts/prepare-legacy-history-recovery.mjs` defaults to dry-run and writes a new private local plan file. It refuses an existing history and never overwrites records. It supports `--apply-staging` only with `--project idogs-app-staging`. Production writes are intentionally unsupported by this command.

Use explicit `--project`, `--dog`, `--former`, and `--output` arguments, with existing ADC credentials supplied by the operator's runtime. Do not put credentials or the private recovery plan into Git or build artifacts.

Production requires separate approval for the code deployment and the reviewed snapshot backfill. Do not restore an entire database or modify the current owner's dog/records. Before application, revalidate the prepared plan against the final helper and apply it create-only after checking that no complete snapshot already exists.

## Observed production dry-run

Pink Girl (`wW4TWwemt67d9MfGW5cS`) has no saved ownership snapshot. Read-only investigation identified 1 vaccine, 4 worming records, 3 notes and 1 reminder with unchanged pre-transfer document metadata, plus 8 gallery images and 3 note images with unchanged pre-transfer object metadata. The current profile photo is post-transfer and is excluded. No production data was written.

This is partial recovery: previously edited/deleted records and the exact original profile fields cannot be inferred. The absence of Firestore backups, backup schedules and PITR was verified for the production project. No cross-project source is substituted.

## Verification

- API tests exercise identity, stranger/wrong-dog rejection, exact-generation signing, overwrite rejection, path validation and missing configuration.
- Recovery tests exercise transfer evidence, immutable timestamp filtering, backdated/edited records, cross-dog/owner exclusion, mutable URL stripping and nanosecond boundaries.
- React tests exercise section navigation, old records, explicit missing history, no edit controls, signed photo requests and failure/retry behavior.
- A real authenticated staging browser check and a staging recovery fixture remain separate from these automated tests. Production Pink Girl is unchanged until an approved backfill.

## Follow-up hardening, 18 October

- Recover eligible same-bucket profile photos and both supported note-photo URL shapes, with the same pre-transfer generation evidence as gallery images. A later profile overwrite remains excluded.
- The staging apply helper verifies the actual Firestore project and rechecks the transfer boundary and absence of existing history inside the create transaction.
- Firestore emulator integration reproduced and fixed a real serialization failure: old audit entries can lack optional `details`. Undefined properties are now removed before snapshot persistence.
- `scripts/test-legacy-recovery-e2e.mjs` exercises actual Firestore create/update metadata, candidate persistence, frozen history after further buyer edits, former-owner listing, buyer/stranger denial and duplicate-recovery refusal. Authentication and Storage metadata are stubbed; this is not authenticated browser or live Storage QA.
