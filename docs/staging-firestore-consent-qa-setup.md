# Staging marketing consent QA runner — owner-gated setup

Scope: **idogs-app-staging only**. Script reads precisely `users/<QA_UID>`. No Firestore writes, no contact export, no email dispatch. CI synthetic tests do not use Google credentials.

## Required GCP setup by owner (one time)
1. Google Cloud Console -> choose **idogs-app-staging** (never **idogs-app**).
2. IAM & Admin -> Service Accounts -> Create service account `idogs-staging-qa-reader`.
3. IAM -> Grant the service account role **Cloud Datastore Viewer** (`roles/datastore.viewer`) on staging ONLY. This is database-wide read access, so IAM cannot constrain to a single document; runner code deliberately reads one specified QA document. For stronger isolation use a purpose-built API instead.
4. IAM & Admin -> Workload Identity Federation -> Create pool `github-staging-qa`; add OIDC provider issuer `https://token.actions.githubusercontent.com`. Map `google.subject=assertion.sub`, `attribute.repository=assertion.repository`, `attribute.ref=assertion.ref`, `attribute.environment=assertion.environment`. Restrict the provider condition to `assertion.repository == 'izipawsltd-Tony/idogs-app' && assertion.environment == 'staging-qa'`.
5. On that service account grant **Workload Identity User** (`roles/iam.workloadIdentityUser`) to the pool principal set restricted to `attribute.repository/izipawsltd-Tony/idogs-app`; keep provider attribute conditions active. No key files.
6. GitHub repository -> Settings -> Environments -> `staging-qa` -> create environment variables: `STAGING_QA_WIF_PROVIDER` (full `projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` resource), `STAGING_QA_SERVICE_ACCOUNT` (service account email), `STAGING_QA_UID` (synthetic staging QA A UID). Limit environment deployment branches and set required reviewers if available.
7. Owner approval is required to land the workflow on the default branch before a standard GitHub `workflow_dispatch` can be used. GitHub UI Actions -> **Staging Firestore marketing consent read-only QA** -> Run workflow -> `opt_out` after a confirmed OFF click, or `opt_in` after confirmed ON. The account's actual UI action still requires browser QA; this runner only independently verifies server persistence.

Never paste secrets, IDs or private keys in chat. Do NOT grant project Owner, Editor, Datastore Owner or Firebase Admin roles. No Firebase Rules, billing or production changes. If a provider rejects the environment claim, inspect GitHub OIDC claims for the exact subject/attributes before adjusting restrictions; do not remove the repository and environment boundaries.

**Limitation:** Admin SDK bypasses Firestore Security Rules; its IAM role can read all staging collections. The runner is read-only by design and IAM role, but this does NOT validate Firebase client Rules or verify all customer opt-outs. Provider unsubscribe suppression is a separate production send gate.
