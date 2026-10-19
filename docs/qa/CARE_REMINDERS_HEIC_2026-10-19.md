# Manual care reminders and HEIC upload

Base: production ee3a4089ca6feb0a650fcf01d9aa9816530067f0.

## Changes
- Manual reminder form on the main Reminders page and each editable dog's Reminders tab. Ten care categories; explicit dog, title, date and lead time. No clinical schedule is guessed.
- Worming saves its optional next-dose reminder atomically; existing treatments have Add reminder. Deterministic IDs match the daily scheduler. Current ownership is checked inside transactions, including the pending-transfer state.
- Vaccine next-dose date is labelled as the optional reminder trigger; existing vaccine reminder behavior is retained.
- Avatar and Timeline photo selection now use the existing shared HEIC decoder/compressor instead of base64-encoding the original HEIC, avoiding the serverless body limit for large phone images.
- Historical snapshot controls remain read-only. No Rules, Storage configuration, environment, billing or production data changes.

## Verification
- Typecheck and Vite build passed.
- Vitest: 117/117 passed, including nine new transaction tests and existing former-owner isolation tests.
- Legacy recovery Node tests: 8/8 passed.
- Existing image compression structural script: 38 passed / 1 failed. The same failure exists before this change: Puppy Edit's direct-upload call does not match the exact source regex. Its component was not changed.
- Authenticated staging E2E and actual HEIC upload/reload remain pending; do not treat unit coverage as an E2E PASS.

## Follow-on scope
Notification switches, native push permission setup, repeat schedules, snooze and reminder editing are not implemented in this first increment. Lead time is saved; this increment does not add new delivery jobs or send real notifications. Existing Email me reminders behavior remains available. No SMS added.
