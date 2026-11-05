# Cloud permanent-deletion QA environment — proposed, not provisioned

## Evidence

Read-only readiness workflow 40187832315 attempt 2 passed for Firebase idogs-app-staging and iDogs Stripe Test. Renewal workflow 40189205681 at 54d8370476cb77194f18343bdaea7d6a48fc4bac passed the staging request business logic, actual Stripe Test renewal stop/readback, cancellation-does-not-restart and exact fixture cleanup. No public endpoint authentication or signed-webhook success is asserted. Initial cleanup diagnostics found an unsupported update of an already inactive inline price; Firestore fixture, customer and subscription cleanup succeeded, and products were archived. The successful corrected run verified price inactivity directly. Stripe retains test history.

The permanent processor remains emulator-only and cannot be enabled by an environment flag. To port and verify the same processor against real cloud services without scanning a shared database or changing recovery protections on a shared bucket, use isolated resources. This proposal does not create them, grant IAM, change Rules, deploy a worker or change Production.

## Exact proposed resources (owner approval required before provisioning)

- Existing cloud project: idogs-app-staging only.
- New Firestore database: idogs-deletion-qa, Standard edition, Native mode, asia-southeast1. Default database untouched. Client access must remain denied; operator SDK only. No real dog/customer data or exports imported.
- New bucket: idogs-app-staging-deletion-qa, asia-southeast1, uniform bucket-level access, public access prevention enforced, versioning off. Set soft-delete retention to zero on this new disposable QA bucket only, so actual permanent removal can be tested without a seven-day recovery wait. No existing bucket retention or CORS change.
- Auth: fresh nonce-prefixed disposable QA users in idogs-app-staging, exact manifest binding; no modification to existing users or claims. Stripe: nonce-bound Test fixtures only.
- New resources can incur Google Cloud usage charges; no budget increase, paid service subscription or Production expenditure is authorised by this proposal.

## Implementation and verification after approval

Provision and read back exact project/resource identities and isolation controls; fail on an existing bucket/database with mismatched ownership or settings. Refactor processor runtime injection while preserving strict emulator guards and adding a separate fixed-target QA guard for this database/bucket and fixture manifest. Test Rules/fencing and stale-worker behavior. Create QA graph/media/Auth fixtures, stop Test renewal through request business logic, process and independently verify record/object/Auth removal and stable retries. Verify no restored generations remain. Keep email delivery and signed webhook readback as separate release checks; do not label a synthetic confirmation as delivered email.

Passing this isolated zero-retention QA cannot prove Production's seven-day recovery lifecycle; also verify the production-like waiting state and actual provider hardDeleteTime against a normal-retention fixture. Before live activation, complete scalable ownership inventory, provider retention/recovery, signed upload draining, operational Auth fencing, post-revocation communication, independent security review, device QA and owner approval of the exact source/deployment.

## Alternative

Keep normal recovery settings and accept the real cloud retention interval for permanent-deletion verification. Do not shorten retention on the shared staging or Production bucket merely to speed up tests.
