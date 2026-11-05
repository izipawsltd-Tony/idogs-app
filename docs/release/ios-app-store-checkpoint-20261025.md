# iDogs App Store release preparation — 25 October 2026 (Adelaide)

## Authorised scope and baseline

Tony explicitly requested public App Store publication in the current conversation. This supersedes the earlier submission/public-release HOLD for this task; do not ask for the same approval again. No blanket authorisation of unrelated web releases, live Stripe mutations, real-data deletion, Rules/Storage/CORS changes or third-party emails is inferred.

Baseline TestFlight 1.0 (42): ec8eef95178a2c518d0191737770b62b1c54ed4e, PR #54. Exact-source TestFlight run 40079137753 / job 120828821933 succeeded. Tony reported PASS for the verification recovery scenario in this conversation; this closes that physical-device scenario, not the entire release checklist. Build 41 View plan details previously PASS.

## Portal observations / changes

App Store Connect signed-in organisation verified as IZIPAWS PTY LTD. App 6823094602, bundle au.com.idogs.app, version 1.0 remains PREPARE_FOR_SUBMISSION. No build selected, no review submission, no publication performed.

Saved: en-AU promotional text, description and keywords from the existing listing draft; subtitle 'Dog records & QR passports'; Lifestyle category; marketing URL https://idogs.com.au; copyright '2026 NN Global Pty Ltd as trustee for NN Investment Trust'. Content Rights observed saved as Yes, necessary rights, after Tony completed the dialog. Support URL https://idogs.com.au and App Review contact Hieu Ngo / hello@idogs.com.au entered and Save invoked; verify final receipt before claiming saved. Landing source contains the public hello@idogs.com.au contact. Reviewer credentials and phone remain blank. Automatic release after approval is the existing portal selection; not yet submitted.

## Age-rating draft and current gate

The Features worksheet was filled with no parental controls, no age assurance, no unrestricted web access, yes user-generated content (public passports/showcases), no social feed/social media, no under-13 social-media assurance, no peer messaging, no paid third-party advertising. These remain draft answers until the wizard is completed; reassess against the final binary.

Tony explicitly approved None for Profanity/Crude Humor, Horror/Fear Themes, and Alcohol/Tobacco/Drug Use or References. Those three answers were entered and the wizard advanced successfully. Do not request that approval again.

Medical/Treatment Information None and Health/Wellness Topics No were entered on the basis of recordkeeping rather than diagnosis/treatment recommendations. Review against final functionality. Public privacy source says the service is not directed at under-18s; consider the appropriate minimum age at the final age-rating step rather than accidentally listing it as designed for children.

The automated approval reviewer rejected selecting None for the three Sexuality/Nudity categories because the owner's explicit three-category approval did not cover them. No workaround is permitted. The wizard remains at Step 4. Ask for one consolidated factual confirmation for remaining absent-content categories: mature/suggestive and sexual/nudity content; violence/weapons; gambling/simulated gambling, contests and loot boxes. Inspect actual later questions before applying answers. Do not claim age ratings completed.

## Remaining release blockers

- Permanent account deletion fulfilment is not operational in build 42. AccountDeletion/PolicyReview explicitly display a non-effective draft; the backend is a request/status/cancel lifecycle and read-only inventory. Do not submit this as a finished permanent deletion service. Existing seven-day target and stopping future renewal business principles are approved for implementation/synthetic QA; live execution and effective publication still need prepared, tested changes. See ios-owner-policy-gate-20261021.md.
- App Privacy is not configured; provider flows, retention, policy text and declarations must agree with the final release binary. Do not assert Data Not Collected.
- Real synthetic-data device screenshots, tested reviewer/demo login, review phone and accurate final review notes still required. No real user data in public assets or repository.
- Pricing/availability and agreements require verification. No StoreKit purchase has been implemented by this work; existing native purchase gates remain. Do not assert that hiding checkout alone establishes Apple approval.
- Select and verify the final tested binary only after the functionality/policy gaps are closed. Submission and actual Apple approval are distinct from TestFlight VALID processing.

This checkpoint is documentation only. No runtime implementation, production backend, billing configuration, Firebase Rules or Storage is changed by this commit. Existing work in other branches remains untouched.
