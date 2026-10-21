# Scheduled reminder replay guards

Stacked on Draft PR #37, canonical SHA cf17baa9bd2c6e29c7928fbcef914ff31b2e65c3. No production deployment, provider send, financial mutation, permanent deletion or configuration change is included.

## Reproduced defect

The scheduler's email admission key included today's date and the rendered email body. A successful email followed by a failed source-record stamp could therefore be sent again tomorrow despite `reminderFrequency: once`. An ambiguous provider response could also admit another send on the next day. Changing the recipient address or rendered dog name changed the key even for the same care event. HTTP 200 without a usable provider receipt was counted as a successful send.

Seven new actual-scheduler tests were run against the parent source before implementation: six failed and one passed. This established the duplicate-send and false-success cases before changing the implementation.

## Final behavior

Scheduled email identity includes project, current account, dog, event type, source record and due-date/milestone. Once-only care events use a stable `once` identity; daily events add the existing UTC calendar day. Rendered wording, dog name and recipient email are not event identities. The provider request is still admitted by the transactional owner/fence journal introduced in PR #37. A settled, in-flight or ambiguous admission blocks another automatic send for the same event. No automatic replay after lease age or provider ambiguity is added.

Vaccination and worming source stamps now record the due date and recipient owner. A genuinely new recorded due date or new current owner may receive their own event. Old stamps without a due-date marker retain conservative suppression for that owner's legacy record; there is no speculative historical backfill. The journal remains authoritative when stamps fail or immutable transferred records cannot be changed. Birthday/anniversary and predicted-heat daily cadence is preserved. Existing source-stamp 20-hour filtering remains in place where a usable stamp exists.

A scheduled email counts as confirmed only if the internal send-email endpoint returns success=true plus a non-empty provider message ID. HTTP failure, invalid JSON, absent receipt or an ambiguous provider exception remains unresolved review work and does not increment emailSent. It must not automatically retry once-only messages after an unknown outcome. The manual-care Resend flow, SMS quota/provider code and billing are unchanged in this increment.

## Verification

Ten actual scheduler tests use synthetic Firestore/provider I/O and an injected failure of source-stamp transactions. They cover next-day replay, lost provider responses, daily cadence, changed content/email, a new recorded due date with successful source stamps, missing provider receipt, birthday, predicted heat and a new owner while the former owner's fence is frozen. The fake stages writes atomically and serializes transactions; the test clock is controlled, including a timezone-independent birthday fixture.

Three added real Firestore emulator cases exercise concurrent claims (one provider invocation), an ambiguous once-only response followed by tomorrow's retry (still one invocation), daily day changes and frozen admission. The harness rejects any non-demo project or non-loopback Auth/Firestore/Storage configuration before RPC. All provider callbacks are synthetic.

Local validation: 260 app tests, 250 inherited/new Auth/Firestore/Storage emulator cases, 44 request/processor tests, and TypeScript/Vite build passed. Cloud CI, exact SHA Preview and read-only smoke evidence is recorded in the Draft PR after publication. Preview method checks are not authenticated real-account or physical-device QA.

## Remaining release gates

Production remains on the separately approved deletion-target backend. This stacked branch includes unpromoted implementation/rehearsal work; it must not be promoted directly over production without reviewing that complete delta. Physical Storage erasure, generation/shared-reference/provider retention, pre-existing sessions, backup/restore/tombstone replay and real provider renewal cancellation retain the gates documented in PR #37. The new identity cannot reconstruct an email sent by historical code that persisted neither a stamp nor a journal; any existing legacy journals require rollout review rather than invented receipts. No staging alias or production alias is moved here.
