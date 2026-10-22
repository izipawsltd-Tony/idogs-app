# iDogs invitation inventory and marketing consent — implementation handover

Status: **offline read-only preflight implemented; production marketing-consent capture NOT installed**.

## Consent UX contract (implementation gate for future product integration)
- Optional, unchecked-by-default **marketing email** checkbox, separate from account creation Terms, checkout, dog-care reminders and operational emails.
- Copy: **Email me iDogs product news and promotional offers (optional).**
- Account creation, product usage and transactional reminders must work when unchecked.
- Record affirmative action with UID, verified email, timestamp, policy/copy version, capture surface, explicit checkbox source and immutable evidence reference; don't fabricate past consent.
- Settings must allow withdrawing consent with immediate suppression; keep minimal auditable opt-out evidence (subject to privacy/retention review).
- Synchronise opt-out with Resend Broadcast Audience/suppression; never restore a previously unsubscribed recipient by contact import.
- Consent should be versioned separately from ordinary Terms; don't use broad Terms acceptance as permission.
- Before production UI or persistence changes, identify actual account signup/settings architecture and privacy/legal owner approval, then separately QA Auth, persistence, unsubscribe, suppression and notifications. This PR does not imply these are deployed.

## Inventory input contract
Private local JSON with `capturedAt` ISO UTC and arrays `auth`, `profiles`, `billing`, `consent`, `suppression`. Join by `uid`; suppression joined by case-normalized email. Every row must be collected from a legitimate read-only export and reconciled at one point in time. Arrays may be empty; missing rows are HOLD, not eligible.

- `auth`: uid, email, emailVerified:boolean, disabled:boolean from current authentication.
- `profiles`: uid, accountActive:boolean, deletionPending:boolean, qaOrInternal:boolean from approved account/deletion and internal classification.
- `billing`: uid, effectivePlan:'free'|'plus', currentSubscription:boolean, promotionPendingOrJoined:boolean from *live* billing. Any uncertainty must be missing/unknown, never false.
- `consent`: uid, email, channel:'email_marketing', choice:'opt_in'|'opt_out', source:'explicit_checkbox', checkboxDefault:false, policyVersion, evidenceRef, optedInAt UTC, revokedAt null or UTC. Do not backfill opted-in status from registration.
- `suppression`: email, status:'clear'|'suppressed', checkedAt ISO UTC. Only trustworthy provider/current suppression observations can claim clear. Unknown => missing/HOLD.

## Run offline without customer data in source control

```bash
node scripts/recipient-inventory-preflight.mjs /private/normalized-recipient-snapshot.json
npx vitest run scripts/recipient-inventory-preflight.test.js scripts/promotion-emails.test.js
```

The stdout contains **only aggregate counts and snapshot freshness**, never contact addresses. No import, recipient export, network access, mutation, automation or send capability. If input is stale (over 5 min), malformed or incomplete, the process refuses to clear it. Keep raw snapshots and logs outside the repository, CI, pull requests and screenshots.

## QA/approval gates
1. Tests and exact-SHA CI must pass. The output has no customer-facing UI; a Vercel Preview, if generated, verifies deploy only and **cannot validate offline recipient identity/consent**.
2. Existing Resend invitation test reached Gmail visually, but actual provider unsubscribe handling has not been tested with a subscribed QA contact.
3. Real eligible user count remains **UNKNOWN** until current Auth/Firestore/Stripe/Resend data and consent evidence are privately reconciled. Resend Audience previously contained zero contacts.
4. Review Australian Spam Act/ACMA consent, identification and functional unsubscribe requirements with a suitably qualified reviewer before sending.
5. Sending, contact import, production changes, customer data writes, login/MFA, paid services and merge require separate owner approval.
6. PR42 remains draft and Stripe native reminder remains sole active seven-day sender.
