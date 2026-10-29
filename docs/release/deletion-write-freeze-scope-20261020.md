# Deletion write-freeze scope for implementation review

Status: source-based review, 20 October 2026. No live Rules, Storage or mutation API is changed by this document. First retrieve and compare active deployed configuration through an authorised Firebase connection. Do not apply an emulator fixture to production.

The emulator proves that the current repository Rules allow a valid owner update despite a frozen deletion fence. Direct Admin SDK writes also bypass the new ledger's cooperative guard. A lease protects workers from each other; it does not protect the user's data from other writers.

| Mutation surface | Source evidence / concrete review target | Required protection before permanent processing |
| --- | --- | --- |
| Direct Firestore clients | `firestore.rules`, `src/lib/db.ts` | Check a server-owned account fence in each relevant write grant while preserving intended read/status/cancellation access. Do not grant clients fence/manifest/ledger access. Test existing valid tokens and every create/update/delete collection. |
| Public scan logs | `firestore.rules` currently includes an anonymous scan-log create grant | Determine current dog owner on the trusted side; never accept caller-supplied owner identity as a bypass. Decide whether minimal public scan analytics must pause or be de-identified during/after deletion. Preserve public passport availability for another owner. |
| Documents/photos and signed upload grants | `api/upload-document.js`, `api/upload.js`, request/confirm media handlers and Storage Rules | Stop issuing new grants; drain/fence in-flight uploads and confirmations; inventory exact bucket/path/generation and shared references; verify live Storage preconditions. A separate Firestore read before a Storage write is not an atomic freeze. |
| Dog/record ownership mutations | `api/transfer-dog.js`, `api/claim-transferred-dogs.js`, status/litter/create/update APIs | Check fence in the same transaction as the ownership/data mutation. Recheck current owner and pending claims, not original tenant alone. Do not create a real transfer to resolve QA. |
| Scheduled reminder work | `api/send-reminders.js`, `api/_lib/manual-reminder-delivery.js` | Gate job claims and provider dispatch, account for existing delivery leases and lost responses. Never send a real email/SMS for deletion QA. |
| Billing | Checkout/portal, subscription reconciliation and webhook handlers | Treat subscription identity, renewal cancellation and existing financial-record obligations separately. A late webhook must not silently recreate deleted private profile data. Review behavior with mocks before any approved live change. |
| Support/deletion control plane | Account deletion request/status/cancel and super-admin review APIs | Allow only intended lifecycle actions. Cancellation cannot reset processing; login is not cancellation. Operator actions require existing admin auth and immutable audit evidence. |
| Backups/restores/exports | Actual provider settings and operator export inventory still unavailable | Define expiration, access controls, restore quarantine and replay of deletion tombstones before a restored system can serve data or issue jobs. Do not remove receipts while replay remains possible. |

## Enforcement contract to verify

- Fence transitions and worker claims are server-owned, bound to UID/request revision and manifest fingerprint. Every relevant writer participates; no public user field or client assertion can authorise a bypass.
- Mutations and their fence check must share an appropriate atomic boundary. For separate storage/provider systems, use explicit operation/grant states and generation/idempotency preconditions; document residual in-flight effects rather than promising an impossible cross-service transaction.
- Recheck current ownership at execution, preserve another owner's records and quarantine unresolved/pending ownership. A changed version/manifest is a hold, never a broad retry delete.
- Maintain resumable receipts and an immutable reviewed inventory. Auth is last. A completed request must not reopen writes after restoration or a late job/provider callback.
- Required synthetic tests: client token before freeze, client and Admin SDK paths, public requests, upload issued before freeze, transfer/claim races, delayed reminder dispatch, late billing callbacks, lost responses, worker restart/takeover and restored backup/tombstone replay.

## Owner boundary

This scope is review preparation, not approval to deploy Rules, change billing/provider settings, enable deletion, create paid backups, broaden IAM or publish the policy. Inspect the actual live configuration first, produce an exact tested Rules/API candidate, and seek separate approval for the concrete production change. A passing durable-ledger suite alone is insufficient.
