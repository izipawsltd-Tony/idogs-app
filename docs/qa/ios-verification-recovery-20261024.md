# iOS verification email recovery — 24 October 2026

Baseline: TestFlight 1.0 (41), source dd01628c2fb2bf4d8cbcae1537ce5a7faa18920d. Owner confirmed Settings → Current plan → View plan details PASS in this session. GitHub TestFlight run 39951865890 and application CI runs 39951865837/39951894539 succeeded.

The owner previously reported missing verification mail for an iPhone signup. Source review found resendVerificationEmail silently succeeded when Firebase currentUser was absent. This increment rejects that state; the verification page blocks resend while signed out, distinguishes expired-session, network and throttling errors, and retains a 60-second resend cooldown after accepted or rate-limited requests. It no longer claims that a verification link was sent simply because the page opened. Provider acceptance is labelled as a request, not proof of inbox delivery. Existing account email and support contact remain visible.

Eight mocked regression cases cover initial entry without sending, accepted requests/cooldown, network/throttling/session/generic failures, signed-out UI, and the actual AuthProvider lost-session rejection. These tests do not send email or prove provider delivery. The cause of the owner's missing inbox message is still unverified. No Firebase, email-provider, backend, Rules, Storage, billing configuration or account mutation is included. Current plan behavior is unchanged.

Next physical-device check: sign into the existing unverified QA account on the new internal build, request one link, inspect inbox/Spam, open the link and return to “I've verified — continue”. Do not create duplicate accounts or interpret mocked checks as successful delivery. Public App Store submission/release and permanent deletion gates remain open.

Local validation: 263 Vitest tests (36 files), four native production environment checks and TypeScript/Vite build PASS. No actual email/SMS send occurred. TestFlight archive/upload/processing and physical-iPhone QA must be verified separately for the new exact commit.
