# iOS internal candidate — 21 October 2026

This candidate brings the reviewed app copy and policy draft from PR #29 (`f7a5c9a171af03fe83aa8d36b0a03f88511f13e6`, app changes previously tested at `ace98516c813b42df057d1ab0226dfcf42566aeb`) onto the mobile branch after Build 34. It is for internal TestFlight QA, not a public release candidate approved for submission.

## Scope

- Replace unsupported data-residency/compliance claims with neutral provider-processing wording.
- Keep proposed deletion, billing and retention terms explicitly labelled draft and not effective.
- Show request status separately from permanent deletion; proposed seven-day fulfilment and renewal cancellation remain disabled.
- Reset Privacy/Terms scroll position when opening each page.
- No backend, Rules, Storage, environment or billing configuration changes; no permanent deletion processor is enabled.

## Backup observation

Following the owner's explicit paid approval, Firebase Console for `idogs-app`, Firestore `(default)`, displayed **Daily backups retention: 7 days** after saving. Weekly backups remain off and PITR remains off. This observation supersedes earlier notes saying a schedule was not yet configured; it does not prove a first successful backup or a tested restore. Storage photos/PDF backup is not included.

Evidence captured locally: `idogs-firestore-daily-backup-7days-20261021.jpg`. No restore, production data mutation, Rules or IAM change was performed as part of that verification.

## Public release blockers

- Safe operational account-deletion fulfilment, complete ownership/media inventory and write fencing remain incomplete. Emulator ledger tests do not establish production readiness.
- Verify provider retention and backup/restore handling, reconcile policy text with actual enabled behavior, and obtain owner/legal review before publishing effective policies.
- Complete App Store listing, privacy disclosures, screenshots and review credentials; re-audit live App Store Connect state before any submission.
- Perform final physical-iPhone regression on the resulting TestFlight build. Existing Build 34 delivery and older device results do not constitute this candidate's device PASS.
- PR merge, production policy deployment, App Store submission and public release require separate owner approval. Use manual release for the eventual approved submission.

## Local validation before TestFlight

- Vitest: 33 files, 246 tests passed.
- Account-deletion request/inventory Node tests: 12 passed.
- Native production environment guard: 4 passed.
- TypeScript and Vite production build passed; existing large-chunk warnings remain.
- No physical-iPhone PASS or TestFlight upload is implied by these local checks. The cloud archive, processing and tester assignment need their own successful evidence.

No public availability date is committed. Apple review timing begins after a complete, owner-approved submission and can be extended by review findings.
