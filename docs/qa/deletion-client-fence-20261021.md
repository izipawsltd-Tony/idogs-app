# Firestore client and public QR scan freeze candidate

## Result and boundary

This increment closes the demonstrated direct-client freeze gap. Every currently allowed Firestore client mutation now checks the authenticated actor's server-owned fence; all other mutation grants remain denied. No fence preserves ordinary writes. Only an explicit `state: open` allows writes once a fence exists; frozen, completed and malformed states deny them. Existing current-owner reads, activity-note/reminder queries and the API-based deletion control plane remain separate from data-write access.

The original breeder's frozen fence does not freeze a transferred dog's current owner. The existing ownership rules still deny the former owner and unrelated users live record access. No fence is created by this increment or by login. Clients cannot read, create, reopen or remove the fence.

Public passport scan logging now reads the current committed dog/owner and fence in the same Admin SDK transaction as its log write. Missing dogs, mismatched passport identifiers, malformed owner fields and frozen owners produce no new log. Direct client scan writes are denied; the current source has no callers of the legacy `logScan` helper. Public response projection is unchanged. Scan logging remains best effort and is not evidence of full public-media deletion.

## Validation

The new emulator matrix exercises every allowed client create/update/delete path under absent, open, frozen, completed and malformed fence states. Additional cases cover a pre-existing client, retained reads/queries, legacy ownership, a transferred dog, unrelated accounts, server-record forgery, mixed-batch attacks and a twenty-record care batch. The QR suite covers committed-owner lookup, legacy fallback, forged/missing targets and a scan/freeze race. Existing request/ledger/renewal suites run alongside these tests. The previous ledger gap demonstration now asserts rejection of the owner client write; its direct Admin SDK bypass demonstration intentionally remains.

Local app regression: 249 Vitest tests and 44 backend request/processor tests passed. TypeScript/Vite build passed with the existing bundle-size warnings. Exact emulator totals and cloud results are recorded in the PR after execution; no cloud or device PASS is inferred here.

## Remaining work before permanent deletion

- Other Admin SDK mutation routes still require integration of transaction-scoped fence checks, including ownership changes, dog/litter creation/status, care APIs and billing/webhook reconciliation. The new helper is not an automatic guard around existing SDK writes.
- Storage uploads/grants, in-flight media, reminder dispatch, ownership/media inventory, provider retention and restored-backup tombstone replay remain separate verification requirements.
- No permanent processor, provider cancellation, paid setting, Rules release, Storage release, policy publication, PR merge or App Store submission is enabled or authorized by this code change.

Production currently runs approved backend `4145b0cef610777a7069fbe9ba5bc79991bb89ec`. This branch is based on the broader implementation/rehearsal branch `a1531caae3fe9b4d5309d43be6086b6fe2ee68d1`; do not promote it over production as an isolated backend fix. Before any Rules release, retrieve and compare the active exact Rules source, review the final API/Rules diff and obtain the separate production approval. No new TestFlight build is required for this backend/Rules-only increment.
