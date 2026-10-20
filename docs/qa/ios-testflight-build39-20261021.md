# iOS TestFlight 1.0 (39) — delivery verified

Runtime source: `54013cb619577019fef28a2681bfa86c49328b97`.

Workflow: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39515941810

Conclusion: **SUCCESS**. Job `118947986789` passed tests, production environment verification/pull, web build, Capacitor generation/sync, compliance declaration, identity validation, signed archive/export, IPA validation, upload, processed-build assignment and artifact upload.

Actual log at `2026-10-20T23:42:28.5966830Z`: `Internal tester assignment PASS for build 39 (1 tester(s))`. The processed-build lookup reached VALID; the workflow assigned an existing tester rather than issuing a new invitation.

IPA artifact `12307709787`, 4,930,136 bytes, SHA-256 `765fd024a06fb0a458c101639c84dc41c0818160f902bac87a13ada0d3464fa9`; reported expiry 27 October 2026. Artifact identity matches this runtime SHA and build number.

## App increment and tests

- Display server-provided processing/update targets and allowlisted renewal status without inventing dates for legacy responses or claiming pending cancellation succeeded.
- Hide obsolete deletion targets on cancelled/completed requests; warn before cancelling that stopped renewal does not restart.
- Record the owner's approval of the two business principles while clearly keeping effective policy and real provider/permanent processing disabled.
- Local mobile checks: 249 Vitest, 12 Node deletion request/inventory and four native environment guard tests; TypeScript/Vite build passed. Exact-source CI `39515941949` / `39515945365` succeeded. Build delivery is not a full physical-iPhone regression PASS.

## Separate backend/rehearsal evidence

Full rehearsal source `a1531caae3fe9b4d5309d43be6086b6fe2ee68d1`: 249 Vitest, 44 Node checks and 31 Auth/Firestore emulator checks passed locally; CI `39515584851` and ledger `39515584908` succeeded. Preview `dpl_7aL5H5qaTC8r32z5rpfuXihr3inQ` reached READY for that exact SHA. Browser Privacy/Terms displayed matching draft/disabled notices; this was desktop Preview QA, not iPhone QA.

Isolated production-based backend candidate: `4145b0cef610777a7069fbe9ba5bc79991bb89ec`, draft PR #31. Local 158 Vitest, 16 Node and eight real Auth/Firestore emulator checks plus build passed. Exact-source push CI `39516048420`, emulator `39516048454` and PR CI `39516240351` succeeded. Preview `dpl_25J1EFSXDkp8MexqnPWdhFPCkzx6` reached READY with matching source; browser GET `/api/account-deletion` without credentials returned `{"error":"Please sign in again."}`. The connector fetch misclassified that application 401 as a protection wall; the actual JSON body was verified in the browser.

The candidate changes only three runtime backend libraries from observed production `8941cff8737140c024f35e8bde115107fa84cc4c`; other changes are tests/workflow/review documentation. It saves seven-day target/update times and one disabled renewal task atomically with a new request. It does not execute renewal cancellation or permanent deletion. Production was re-observed READY at `dpl_Fe5XxYFrDzhw2hNXL7MxLLwHKHkw`, same SHA, after Preview verification.

## Gate and limitations

Separate owner approval is required to deploy that exact isolated backend to `idogs.com.au`. Recheck current production before acting. Approval of the business principles did not approve production deployment, live Stripe operations, real deletion, Rules/Storage changes, effective legal publication, PR merge or App Store submission/release.

Global write fencing, complete ownership/media/provider inventory, durable operator updates/escalation, backup restore/tombstone verification and safe permanent processing remain incomplete. The earlier cleanup rehearsal is not a production worker. Do not activate it or treat the new renewal-task rehearsal as live provider integration. Before any live worker activation, reconcile pending-task cancellation wording and verify that accepted renewal-stop work is not silently withdrawn or restarted when deletion is cancelled.

No full physical-iPhone regression, first successful Firestore backup/restore, Storage media backup, solicitor sign-off or public-release readiness is claimed. The latest ASC metadata inventory still has substantial submission gaps; it preceded Build 39 and is not a new selected-build audit.
