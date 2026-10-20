# iDogs App Store listing draft — not published

App ID: 6823094602. Locale: en-AU. Confirm final marketing version before creating the release binary. Draft copy describes existing functionality; new reminder features on other branches are excluded.

## Proposed fields

| Field | Draft |
| --- | --- |
| Name | iDogs |
| Subtitle | Dog records & QR passports |
| Category | Lifestyle (proposal; confirm owner preference and platform configuration) |
| Price | Free download (proposal; paid service treatment requires separate billing decision) |
| Privacy policy URL | https://idogs.com.au/privacy — verify final corrected content and public availability |
| Support URL | A public support/contact page is needed; do not invent a /support endpoint |
| Marketing URL | https://idogs.com.au — verify public page before entering |
| Copyright | 2026 IZIPAWS PTY LTD — owner must confirm licensed IP attribution wording |
| Release option | Manually release this version |
| Keywords | dog,puppy,breeder,pet,records,vaccination,worming,reminders,pedigree,passport |

## Promotional text

Keep your dog's records together, stay on top of care reminders and share a QR Passport with iDogs.

## Description

iDogs helps Australian dog owners and breeders keep everyday dog information organised in one place.

Create dog profiles, keep vaccination and worming records, save photos and documents, and manage care reminders. Open your dog's QR Passport to view the information available on its public page.

For breeders, iDogs also includes litter records and puppy information, helping you keep track of your breeding program alongside individual dog records.

Features include:
- Dog profiles and life-stage information
- Vaccination, worming and health records
- Photos and document storage
- Care reminders
- Permanent Dog ID and QR Passport
- Litter and puppy records for breeder accounts
- Ownership transfer workflows

An iDogs account and an internet connection are required. Features and limits depend on your account's access. Purchases are unavailable in the iPhone app in this proposed release.

Before publication: remove or revise the last sentence if StoreKit is implemented. Do not advertise offline access, native push notifications, boarding management, compliance certification or diagnosis. AI scanning is deliberately omitted from listing copy until the permission/disclosure gap is resolved and reviewed.

## What's new

Initial iPhone release. Confirm whether this field is required for the initial store version.

## Reviewer notes — draft

iDogs is an account-based dog-records application for pet owners and breeders. A dedicated review account with synthetic dog/litter records will be supplied in the protected App Review Information fields.

Suggested review path:
1. Sign in with the supplied review account.
2. Open Dogs, then the synthetic dog to inspect its records and documents.
3. Open QR Passport and preview the public passport.
4. Open Reminders, Litters and Activity.
5. Open Settings → Current plan → View plan details. In the proposed no-purchase build, this is read-only and cannot open an external checkout.
6. Inspect the completed in-app account deletion initiation path using the designated disposable fixture account.

This is a draft, not a claim that deletion or review credentials are already configured. State the chosen billing basis accurately; do not claim an Apple policy exception that has not been established. Supply a separate disposable account for deletion review and protect shared records during deletion.

## Screenshot capture brief — actual assets outstanding

Use current Apple screenshot specifications for the binary's supported device families. Capture real release-candidate screens with synthetic data; do not fabricate functionality or reuse personal QA screenshots as public marketing assets.

| Frame | Actual screen | Caption proposal |
| --- | --- | --- |
| 1 | Synthetic dog list/dashboard | Your dogs, organised |
| 2 | Synthetic Dog Detail | A record for every stage |
| 3 | Vaccination/worming records | Keep care records together |
| 4 | Reminders | Stay on top of dog care |
| 5 | Public QR Passport with synthetic identity | Share a QR Passport |
| 6 | Synthetic breeder litter records | Manage litters and puppies |

Exclude real names, phone numbers, addresses, microchips, buyer details, invoices and review-account credentials. Check status-bar/safe-area legibility and bottom navigation at the final capture size. Do not imply native push or offline functionality without evidence.

## Privacy worksheet — draft, not final App Privacy declarations

| Data flow observed in source | Candidate Apple disclosure area | Verification needed |
| --- | --- | --- |
| Account name, email, phone, kennel profile | Contact Info / Identifiers, linked for app functionality | Confirm optional fields, backend retention and processor use |
| Firebase account UID | User ID, linked for app functionality | Check all authentication/SDK collection |
| Dog photos, uploaded documents and notes | Photos or Videos / Other User Content | Files can embed human details; inspect real collection without disclosing private samples |
| Subscription/invoice status retrieved for existing subscribers | Purchase History, linked | Confirm the app/server data actually retrieved; card details are not entered in native UI |
| Activity records and service logs | Product Interaction / Diagnostics as applicable | Confirm hosting logs, IP addresses, analytics and retention rather than assuming |
| Document images/PDFs sent to Anthropic for scanning | Third-party AI processing | Add explicit informed permission before upload; name provider and purpose in accurate policy |
| Public QR Passport data | User content made public by sharing | Confirm exact public fields, consent and privacy boundaries |

Do not select “Data Not Collected” or certify a tracking declaration without completing this assessment. Dog veterinary information is not automatically human health data; uploaded documents may nevertheless contain personal information. Legal wording and final App Privacy answers require owner review.

## Secure fields still needed in App Store Connect

- Reviewer contact details and a dedicated tested demo login; credentials stay outside this public repository.
- Actual screenshots; privacy/support URLs; final age-rating answers; App Privacy declarations.
- Confirm agreements, availability, pricing and content/IP rights.
- Matching release binary, chosen after the confirmed submission gaps are closed.
