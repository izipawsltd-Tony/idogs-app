# Puppy lifetime profile — QA candidate

## Scope and baseline

Owner-approved build for QA only. Production release requires owner QA approval.
Baseline: live Production `4d520a069e6697564a47a38e71468924c17b0ce1` (Vercel READY `dpl_D3UNYFsNizqquzbPfSAL541vvviw`).
`master@bd3aa96d` differs substantially from that release; it was inspected and not merged wholesale.

The existing `/p/:passportId` QR address remains unchanged. Showcase cards link to that profile. A public Updates tab offers free-account following; signed-in customers return through Following puppies. Signup returns to the exact puppy and defaults to the owner account type. Existing web/native API routing remains in place; no new App Store/Play binary is published by this task.

Timeline has a separate customer-update composer for multiple photos/videos, date, text and up to 12 owned puppies. Existing private notes are never automatically republished. Reuse the current upload validation/compression pipeline and reference one uploaded object when sharing a group update. Story uploads use `puppyProfiles/{dogId}/media` instead of growing the capped Showcase gallery, allowing long-term history without deleting old photos. Select from the latest 100 story uploads and existing owned gallery media. Videos remain capped at 20MB and every update at 12 media items. Existing gallery upload semantics and caps remain unchanged. Removing an underlying gallery file also removes its availability in updates which reference it.

## Access and retention

- Default audience: Only me. Public updates additionally require explicit per-puppy public-sharing opt-in by the current owner.
- Following saves a profile; it grants no reservation, deposit, ownership or private data access.
- Buyer updates require verified email, active existing dogPrivateAccess grant, deposit received and a grant issued by the current effective owner. Grant/revoke is available in Timeline and existing Showcase controls.
- During handover, public story sharing and publication pause. Acceptance keeps the same dog/passport ID. A new owner sees previously shared public/buyer entries, never the former owner's internal entries. Public sharing is off for inherited content; the new owner can remove inherited shared entries but cannot republish the previous author's content or notes.
- Former breeders cannot write or read new private updates. Their existing immutable ownership-history feature remains unchanged.
- New server-only collections: `puppyProfiles/{dogId}` with `updates/{id}` and `media/{id}` subcollections, and `puppyFollowers/{uid}/dogs/{dogId}`. All accesses are mediated by Admin API; existing Firestore default-deny covers direct clients, with no Rules deployment or IAM change. The existing manual account-deletion inventory must retain its hold on unknown/nested collections until these are classified; this release does not authorize or perform automatic data purging.
- Mutations recheck ownership in transactions. A stable caller request ID makes retries idempotent. Input and media path allowlists prevent cross-dog/tenant signing. Access is rechecked after media signing to reject a stale response if ownership or viewer privileges change mid-request. Lists are paged at 25 records; followers capped at 100 per account.
- Public media rechecks current audience/owner/opt-in on every request then redirects for at most 60 seconds. Private media signed URLs last up to 5 minutes after issuance; revocation blocks new URLs immediately, with that residual window for already-issued URLs. Downloads already saved cannot be recalled.
- No update email or SMS is sent; follow/unfollow is not marketing consent. No billing, subscription, scheduler or Production settings are changed.

## QA deployment

Dedicated project `idogs-puppy-journey-qa`, staging client/Admin/Storage only. Workflow explicitly validates all Firebase project/bucket identities. No SMS, Stripe, Resend or other external-service credentials copied. The Vercel `production` target in this dedicated QA project denotes its stable QA alias; it is unrelated to the live `idogs-app` project or idogs.com.au.

Assigned stable QA origin: `https://idogs-puppy-journey-qa-izipawsltd-tonys-projects.vercel.app`. Storage Staging CORS was extended with that exact origin for PUT and the existing signed-upload headers, preserving all existing entries. No wildcard origin, bucket IAM change or Production change. Synthetic users/dogs use `qa-puppy-journey-…-20261028`; no customer data or real notifications are used. Synthetic credentials remain outside Git and are never printed.

## Owner QA checklist

1. Breeder: My Dogs → puppy → Timeline → Photos & customer updates. Copy permanent link and open as visitor; private notes must be absent.
2. Upload photos and a video, select audience, optionally select littermates. Publish. Refresh the same QR address; only Public items with sharing enabled should appear.
3. Visitor: Follow with a free account → verification → same puppy. Confirm owner account type and profile saved in Following puppies. Use website without installing app.
4. After deposit Received: grant the buyer email from Timeline. Buyer signs in with that verified email; private updates appear. Another account sees only public content.
5. Revoke the grant or turn off public sharing. New requests lose the corresponding access; allow the documented signed URL window.
6. Transfer a disposable QA dog and accept as the intended buyer. Same QR works; shared history remains; internal notes stay absent; former breeder cannot update. New owner continues Timeline entries and care features.
7. Existing vaccines/health/info QR tabs, Showcase enquiry and normal ownership invitations still work.

Automated results and deployment identifiers will be recorded after final QA.
