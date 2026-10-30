# iDogs account upgrade — server recovery decision

Status: owner approved QA/emulator development with fake SMS in chat on 31 October 2026. Recovery prototype results are in `ACCOUNT-RECOVERY-QA-20261031.md`. This is not production/live-SMS approval. The inspection/proposal below records the original decision basis.
Branch: `feature/account-onboarding-recovery-20261031`, based on `b43218e22a76d488a8ea2f47d4cd7b1d39f3e14e`.
Scope: web account flows; native iPhone/Android verification remains separate.

## Verified configuration (read-only)

Inspection at 2026-10-30 21:11:43 UTC (31 October in Adelaide):

| Configuration | Staging `idogs-app-staging` | Production `idogs-app` |
| --- | --- | --- |
| Auth subtype | FIREBASE_AUTH | FIREBASE_AUTH |
| Email enabled | Yes | Yes |
| Password required in email-provider configuration | No (legacy email-link configuration) | Yes |
| Phone provider | Enabled | Enabled |
| SMS regions | US, AU | AU |
| Blocking functions configured | None | None |
| Billing enabled | Yes | Yes |

Evidence is the sanitized local file `../puppy-journey-qa/onboarding-auth-readiness-20261031.json`. No configuration changed, no real SMS sent, no production user records read. An enabled provider does not prove SMS delivery, available quota, or a complete account journey.

## Accepted product contract

1. Email/password is the main login. Phone signup remains available but requires verified email and a working password on the SAME UID before account management.
2. Preserve existing OTP customers' access while they complete onboarding. Do not delete, merge or re-create identities. One verified Auth phone belongs to one main account; a contact phone on a profile is not authentication proof.
3. Public QR stays public for explicitly shared content. Signing up must not increase access to private records.
4. Password reset and forgotten-email recovery are separate flows.
5. Settings number replacement requires primary-method reauthentication followed by proof of the NEW number. Never unlink the old number first. Never touch subscription IDs, dog ownership or profile contact/marketing fields as a side effect.

## Recommended recovery design — keep ordinary Firebase Auth

Use an iDogs server-owned OTP challenge, separate from Firebase phone sign-in. The repo already contains a ClickSend transport for reminders; this is a reuse candidate, NOT evidence that its account/sender is ready or that recovery has permission to send messages.

Proposed endpoints:

- `POST /api/account-recovery/start`: canonical AU number, browser anti-abuse proof and limits. Uniform public response; random opaque challenge. No email, UID or account-existence details.
- `POST /api/account-recovery/verify`: valid unexpired one-time code required. Then use Admin `getUserByPhoneNumber`, never profile-contact search, never `createUser`, `signInWithPhoneNumber`, `accounts:signInWithPhoneNumber`, or unrestricted custom login tokens.
- Re-read Auth and lifecycle state at verification: disabled/deleting/revoked mapping must fail closed. Bind challenge to the original UID/phone mapping so changing or reassigning a number invalidates stale recovery. Reveal the email only after proof; an incomplete account instead receives completion guidance. Recovery itself is not a signed-in session.
- For an unknown number return the same challenge response but do not send a real OTP or create an Auth user. Submission of arbitrary codes fails generically. Add timing/failure-path review so delivery/timing does not become an easy enumeration signal.
- OTP security: cryptographic random six-digit code, keyed HMAC at rest with a server-only secret (a plain hash is insufficient for six digits), five-minute expiry, maximum five attempts, 60-second resend spacing, phone/IP/device/global throttles, daily spend cap. Store challenge state server-only; TTL cleanup is housekeeping, not expiry enforcement. Compare secrets safely and atomically consume challenges; parallel successful submissions must not replay.
- Send ambiguity: do not blindly retry a timed-out SMS send or double-charge. Reuse the challenge/cooldown or require an explicitly controlled retry.
- Do not put full phone/email/OTP in analytics, URLs, access logs, browser storage, or error payloads. Verification response uses no-store. Do not reuse recovery proof for changing the password, phone, ownership or subscription.
- Use a separate recovery sending flag and cost ledger. Do not consume breeder reminder add-on credits or interpret marketing consent as authentication permission.

Important limitation: ordinary Firebase phone sign-in can create an Auth user on first sign-in. Merely changing the UI does not disable that API. This proposal ensures NO creation in the recovery path; it does not claim to eliminate all possible phone signup. Existing phone signup/migration remains separate. SMS possession also has number-recycling/SIM-swap risk; unusual/high-value accounts should use a separate reviewed support process.

## Cost and impact

| Item | Cost/impact |
| --- | --- |
| Build/unit/emulator recovery prototype | No real SMS, no provider purchase or Firebase upgrade. Existing development resources only. |
| Live server recovery using existing ClickSend candidate | SMS price must be verified for the existing AU account and sender before enabling. Public pricing is dynamically rendered and the fetched page returned placeholder zeroes; those are NOT a valid quote. No assumed unit price. Formula: delivered/billable SMS segments × confirmed account rate, plus applicable carrier charges/GST. |
| Compute/state | Existing Vercel functions + Firestore can host endpoints/challenges, with additional usage charges depending on traffic and plan; no claim of zero cost. Each challenge needs rate-limit state, attempts and transactional consumption; quote after expected volume is known. |
| Suggested live pilot control | Separate owner-approved budget, AU destinations only, hard stop before daily/monthly cap, resend/abuse limits. No live cap or billing permission is assumed in this proposal. |
| Firebase-native alternative | Identity Platform upgrade + blocking hooks would alter the project-wide auth path, add operations/compute and require separate approval and migration QA. Not selected or applied. |

For comparison ONLY, Google's published AU phone-auth SMS rate is USD $0.02/message (first ten SMS/day not billed), so 1,000 messages has a USD $20 list-rate baseline before free allowances/tax/other costs. This is NOT a ClickSend quote or the proposed custom-recovery cost. Identity Platform Tier 1 MAU pricing lists the first 50,000/month free, then tiered charges. Neither price implies an authorized upgrade.

Sources checked 31 October 2026:
- https://firebase.google.com/docs/auth/web/phone-auth (first sign-in creates an account)
- https://firebase.google.com/docs/reference/js/auth (reauthenticateWithCredential, updatePhoneNumber)
- https://docs.cloud.google.com/identity-platform/docs/blocking-functions (upgrade and blocking hooks)
- https://cloud.google.com/identity-platform/pricing (comparison rates)
- https://www.clicksend.com/au/pricing/?region=au&currency=aud (requires confirmed live account pricing; fetched placeholders not used)

## Remaining onboarding/enforcement work

Original pending scopes at the decision point (recovery fake-SMS QA has since been implemented; see the linked checkpoint):
- Resumable phone → email verification → password completion on the same UID, including refresh/new-device/expired-session/conflicting-email cases.
- Trusted server readiness proof and API/Firestore/Storage management enforcement. A mutable client/profile flag or `providerId === 'password'` is insufficient (email-link also uses the password provider). Confirm actual email/password sign-in and verified Auth email, then store server-owned readiness tied to the current email/UID. Review how existing email users migrate without blanket lockout.
- Compatibility route for existing OTP customers, email-password login/reset, account-deletion exceptions, and preserving original QR/follow destination.
- Recovery endpoints/UI, anti-abuse protection, costs, and unknown-number Auth-user-count tests.
- End-to-end staging and real iPhone/SMS verification; production release.

Do not remove the existing OTP entry until the same-UID completion path and backend enforcement have passed. Do not deploy the partial Settings change as the complete upgrade.

## Owner gate

Approved in chat: recommended server-owned recovery architecture for QA/emulator development with fake SMS only, keeping ordinary Firebase Auth. This approval does NOT authorize Identity Platform, production config changes, live SMS, purchases, or deployment. Live delivery requires a verified quote/sender and a separate spending decision.
