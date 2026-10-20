# Internal iOS candidate after owner policy approval

The owner approved the seven-day service target/update and renewal-stop principles on 21 October 2026. The effective policy and real provider execution remain separately gated.

This native increment ports only the app status UI, approval notice and its tests from backend/rehearsal source `a1531caae3fe9b4d5309d43be6086b6fe2ee68d1`. The app shows server-provided targets and pending/review/verified renewal states, hides obsolete deletion targets on cancelled/completed requests, and warns before cancelling that stopped renewal does not restart. Legacy backend responses remain supported without invented dates or billing success.

The new backend request/task implementation remains on its separate review branch. This mobile increment does not deploy it or activate permanent deletion, subscription changes or legal publication.

Local mobile validation: 249 Vitest tests across 33 files, 12 Node deletion tests, four native environment-guard tests and TypeScript/Vite production build passed. The matching backend/rehearsal source passed CI `39515584851` and ledger verification `39515584908`, including 44 Node checks and 31 Firestore/Auth emulator checks. No physical-device QA or delivery result is inferred from local tests; the new TestFlight run must supply separate evidence.
