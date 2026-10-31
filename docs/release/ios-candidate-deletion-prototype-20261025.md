# Internal iPhone candidate — deletion status prototype

Continue the existing iOS 1.0 internal TestFlight pipeline on the isolated release branch. This candidate incorporates the deletion status UI from prototype commit 12c5ab98e289e111aabdd1fd0f7e9e43e5c0d0c2. The actual build number is the TestFlight workflow run number, not a guessed or manually reused value.

The workflow checks production client Firebase identity, runs tests, builds and signs the iPhone app, uploads to TestFlight, and verifies assignment to the existing internal QA testers. It does not submit the app for App Review, select an App Store build, publish privacy declarations, deploy backend/Rules or activate account deletion.

## Internal QA

- Update iDogs in TestFlight and confirm version/build from the successful workflow.
- Verify sign-in, dashboard, existing dog records, documents, reminders and Settings.
- Settings → Delete account: opening the panel must only read request status. Do not submit a real deletion request for QA.
- Draft policy notice must remain visible. Actual permanent deletion and automatic renewal cancellation are not available on the current production backend.
- Processing/completion states were tested with synthetic emulator data. Do not infer real deletion from this internal binary.

## Release blockers

Production deletion processing, provider verification, upload ingress draining, restricted retention/disposal and restore safeguards require implementation and review before App Store submission. Final privacy policy/disclosures, real reviewer login QA and device screenshots remain separate release requirements. No deployment or submission is approved by this candidate note.
