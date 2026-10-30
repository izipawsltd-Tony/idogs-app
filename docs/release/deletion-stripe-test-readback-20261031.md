# Private real Stripe TEST readback — 31 October 2026

This default-disabled QA component is separate from the emulator loopback transport. It is called only inside the existing permanent-deletion CI fixture, after the original disposable manifest, Auth account, profile and Storage objects already exist. It adds no resource or provider mutation and changes no ordinary route or shared Stripe client.

`createCloudStripeReadback` binds the existing staging project, named deletion-QA database, zero-retention QA bucket, exact UUID-derived run/UID, revision1, original manifest hash, private Auth creation/email binding and pinned profile content. The existing CI runtime supplies its already configured TEST credential directly; the key never leaves that process through this component. Repository, release ref, source SHA and GitHub run are pinned and rechecked.

A separate private Stripe SDK client permits only HTTPS443 api.stripe.com GET /v1/account, the exact manifest customer, and the exact manifest subscription. No lists, query parameters, connected-account/context override, mutation, redirect destination, configurable origin or returned SDK handle exists. Account acct_1TiU0IGHgBd6ZgJE must match before customer/subscription reads. Both resources must be TEST mode and bind exact firebaseUid/deletionQaRunId metadata; the subscription must reference the original customer. Every wire rechecks source evidence. Responses are reduced to hashes and allowlisted proof fields.

Each path has an irreversible in-memory attempt latch; the reader is single use. Native socket errors are wrapped with their cause retained privately so the installed SDK cannot silently retry ECONNRESET/EPIPE before its retry limit. This is read-only attempt control, not a durable cross-service mutation/terminal receipt protocol. It does not alter existing fixture creation, cancellation or cleanup transports. Unknown mutation behavior of those older paths is not proven by this component.

Seven local Node contracts use the installed SDK serializer and a mocked underlying HTTP response, with no Stripe service IO: disabled/wrong context/runtime, three exact GETs and private output, wrong account preventing further reads, response substitution, late profile/manifest/revision/Auth changes, reset/pipe single-attempt behavior, and CI drift/removed actor. They are not actual provider evidence. Exact-source existing cloud workflow proof is pending; the new readback must succeed there before actual TEST binding is claimed.

## Provider-issued webhook signature Owner Gate

The existing `deletion-webhook-session.mjs` creates/configures a webhook endpoint, preview deployment, bypass and branch environment values. Those actions fall outside the current no-new-resource/no-provider-setting/no-deployment scope. It must not be executed under the read-only increment. Existing local crypto tests and real TEST GET binding are distinct from provider-issued signature delivery. No endpoint/key is created or exported and signedWebhookVerified remains false. A future exact-source direct-chat review must identify an already authorized delivery capability or explicitly approve the concrete missing external actions. Independent engineering continues meanwhile.

This increment does not activate a live adapter, release any issuer/event/unknown-outcome lease, prove provider authorization drain, change the original retention fixture or provide Production readiness. No email/simulation is sent. Original seven-day/managed-recovery restrictions remain intact.

## Initial provider readback failure and scoped diagnostics

Source d5a10bb26bd31c68adffca2f5cf9b058b75dda46 cloud41145434000/job124369299823 failed at private_stripe_test_readback. Existing cleanup verified true for all six cleanup steps; no Storage CAS probe had started. Do not relabel this source PASS. SDK connection wrappers can discard the top-level error code; the old outer reporter reduced it to CLOUD_PERMANENT_QA_FAILED, so its exact provider/guard cause is not yet established.

The revised reader preserves allowlisted inner guard codes and fixed account/customer/subscription/final-runtime stage, attempt count and error class. No raw response, header, URL, key or error message is logged. An eighth no-network contract verifies the installed SDK wrapper behavior and diagnostic redaction. A changed-source diagnostic QA can be assessed only after confirmed cleanup and no concurrent fixture; it is not a retry of an unknown mutation or a replacement to obtain PASS. No claim that the original failure is fixed is made from another run alone.

Source8c7fadcb cloud41145985047/job124371090963 also failed, now narrowed to subscription stage after3 HTTP attempts, errorType other; all cleanup steps again verified true. This is not a second PASS or a fixed network claim. Revised diagnostics distinguish the subscription SDK call from post-response binding/hash and emit only an allowlisted local source location, fixed error name and numeric response status. No raw provider/error content or guard change is introduced. Do not repeat unchanged sources.

## Located serialization fault and bounded receipt correction

Sourcea98cf39a/cloud41146599360/job124373043784 failed with HTTP200, step subscription_response, TypeError at deletion-plan.js:13:65 (generic digest serialization), after three HTTP attempts. Cleanup verified true for all steps. This locates a receipt serialization defect after the provider response; it does not prove a Stripe network/binding failure or the exact problematic opaque field. Raw payloads were not exported.

The correction hashes only validated primitive binding facts: account ID; customer ID/TEST mode/UID/run; subscription ID/customer/TEST mode/UID/run. Full opaque SDK objects are outside this receipt's authority. All prior exact manifest/profile/Auth/metadata/transport checks remain mandatory. A ninth local contract adds non-JSON opaque fields which previously break the generic digest while retaining every binding assertion. Local19 related contracts PASS. Changed-source real provider proof remains pending; do not relabel any failed source PASS.
