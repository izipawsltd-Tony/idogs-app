# iDogs — preliminary Australian legal-policy review

Review date: 19 October 2026. Base: 855426c23b3f6865c8e0d993213308739921b457. Scope: coordinated Privacy Policy, Terms and in-app account deletion disclosure. **DRAFT / NOT EFFECTIVE / PUBLICATION BLOCKED.** This is a source-based legal issue review, not advice or approval from an Australian solicitor. No solicitor was contacted or engaged.

## Result

The identified 30-day, refund, data-location and unsupported compliance claims have been corrected in an isolated review candidate. The three surfaces reuse src/components/legal/PolicyReview.tsx so proposed deletion, billing and retention wording stays consistent. Each identifies the draft and distinguishes proposals from current request-only functionality. No production policy, TestFlight binary, Stripe, Rules, Storage, env or account data is changed.

The wording can be reviewed, but publication is not approved. Copy changes alone do not establish operational or legal compliance.

## Reviewed changes and source mapping

| Issue | Review outcome | Basis / limitation |
| --- | --- | --- |
| Old automatic 30-day deletion promise | Removed from Privacy and Terms. The seven-calendar-day period is expressly a proposed service target, not a legal deadline or waiting period. Delays require an explanation and next update date. | OAIC APP 11 requires reasonable destruction/de-identification when information is no longer needed for a permitted purpose, with retention exceptions. It does not establish this proposed universal seven-day promise. Operational ability still unproven. |
| Recurring charges during deletion | Proposed rule now acts on future renewal when the valid request is accepted, rather than waiting for cleanup. If provider status is unresolved, notify/escalate before renewal; no silent indefinite hold. Cancelling deletion does not restart billing. | Business-policy proposal, not a statutory cancellation mechanism. No cancellation, refund or Stripe operation is implemented/enabled by the copy. Existing billing controls and consumer rights remain relevant. |
| Absolute no-partial-month-refund wording | Replaced with a distinction between change-of-mind cancellation and remedies required by law; non-excludable ACL rights expressly preserved. | ACCC says businesses cannot remove applicable remedies for faulty services. No blanket entitlement or refusal is asserted for every scenario. |
| Company financial retention | Explain at least seven years for relevant company financial records; exclude blanket retention of all dog/account data. | ASIC company record-keeping guidance. Record-by-record classification, start date, longer obligations/holds and actual disposal must be checked. Do not rely on a generic five-year tax-record rule to shorten a company's obligations. |
| Shared dog/history records | Protect other current owners while assessing departing-person private details for removal/de-identification; shared history is not blanket justification for indefinite personal-data retention. | APP 11 permitted-purpose/retention assessment where applicable. Breeder/state obligations and controllers' roles remain unverified. |
| Backups, public passports and providers | Include them in the inventory; remove immediate/all-systems deletion assurances. | OAIC APP 11 addresses copies and backups. Actual vendor capabilities and documented expiry/restore suppression are still missing. |
| All-data-in-Asia-Pacific / strict-DPA claims | Removed. Disclose potential overseas processing and require verified locations/contracts before effectiveness. Provider list includes Firebase/Google, Vercel, Stripe, Resend, AWS/SNS where SMS is enabled, Anthropic optional AI. | OAIC APP 8 requires a contextual overseas handling assessment where applicable. An ordinary AI consent checkbox is not assumed to waive APP 8 responsibilities. No unverified no-training, residency or retention guarantee. |
| AI disclosure | Selected document, provider, purpose, potential human details, per-document permission, cancellation/manual alternative and profile storage explained. | Matches the implemented consent boundary; contracts, locations and retention remain release checks. No AI diagnosis promise. |
| Statutory rights/compliance badge | Remove blanket compliance certification and an unqualified statutory deletion-right claim. Access/correction/deletion requests and complaints remain described without inventing coverage. | OAIC small-business guidance requires assessing turnover, exceptions, related bodies and opt-in; low SaaS revenue alone does not resolve coverage. |
| Terms risk clauses | Add ACL protection to warranty/liability language; narrow arbitrary termination, preserve mandatory forum rights and avoid treating review-page viewing as acceptance. Remove unverified IP attribution. | Preliminary drafting improvements, not a complete unfair-contract-term or IP title opinion. Liability cap, suspension, variation, pricing and ownership/licence records still need professional review. |
| Effective date / notice | Both pages say review version, not last-updated/effective date. No immediate acceptance of draft terms. Preserve the existing public Privacy promise of at least 14 days advance notice for material changes. | This 14-day period is an existing iDogs commitment, not a general rule asserted for every Australian business. Notice/effectiveness process and applicable law must be reviewed before rollout. No notification was sent. |

## Publication blockers / required evidence

1. **Operator and IP:** verify legal name, ABN, contact mailbox operation, software/brand ownership and licences against records. Existing attribution is not proof of title. No corporate or trademark transfer is proposed.
2. **Privacy Act scope:** establish entity/related-entity coverage, applicable exceptions and any opt-in. Confirm other obligations rather than claiming blanket exemption or compliance.
3. **Provider register:** verified countries/regions, subprocessors, contract terms, purposes, personal-data categories, security and deletion/retention controls for each actual processor. Confirm full SDK/cookie/diagnostic inventory. No provider contracts or full processing, training, retention or backup settings were verified in this review. Read-only Vercel deployment metadata is recorded below; it is not a complete residency inventory.
4. **Retention schedule:** for each collection, uploaded/public file, support/audit/delivery record, financial record, shared history, provider copy and backup, document purpose, legal basis, retention start/end/review, access controls and disposal. Financial obligations of the SaaS operator are not automatically the retention rule for every breeder's hosted data. State/territory and breeder-specific requirements need separate assessment.
5. **Operational fulfilment:** safe complete inventory, verified write freeze, ownership/generation rechecks, resumable cleanup, legal/billing holds, completion receipt, backup restoration handling and synthetic race/retry/failure evidence. Current permanent processor is disabled. Do not activate a seven-day promise before the operation can meet it.
6. **Billing:** implement/test prompt renewal cancellation and truthful status, failure escalation before next renewal, any law-required refund process and no automatic reactivation. No real subscription/payment changes are authorised by the draft.
7. **Publication:** Resolve the documented legal/factual issues and obtain owner approval of final policy/business rules; independent Australian solicitor review of the final text and unresolved clauses is recommended; notice/effective-date plan consistent with existing commitments; exact-SHA deployment approval; App Privacy answers and reviewer materials aligned. No App Store submission or PR merge is approved.

No seven-day deadline, automatic cancellation or completed deletion is represented as currently enabled. Do not simply remove the draft notice and deploy this candidate.

## Primary sources checked

- OAIC APP 11: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information
- OAIC APP 8: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-8-app-8-cross-border-disclosure-of-personal-information
- OAIC small business: https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business
- ACCC remedies: https://www.accc.gov.au/consumers/problem-with-a-product-or-service-you-bought/repair-replace-refund-cancel
- ASIC company records: https://www.asic.gov.au/for-business-and-companies/companies/company-building-blocks/company-record-keeping

ATO's section-286 page failed to load during this review; no claim of a fresh successful retrieval is made. ASIC's current guidance was accessible. Provider terms, legal entity records and state-specific breeder-retention advice were not verified.

## Exact-source technical evidence

- Policy candidate: 9ad08515f39e80a02ca60dbb1ed2c2b194f7d24f; draft PR #29, base mobile branch. PR #25 is not merged.
- 245 Vitest checks PASS; TypeScript/Vite build PASS. Exact-source CI 39252751280 and PR CI 39252798673 SUCCESS. Existing bundle-size warning remains.
- Protected staging-project Preview dpl_B8XH2LTK3eXXUfxvdhH6xfYJKQo2 READY with the exact candidate SHA. Project SSO protection observed as all_except_custom_domains; no custom alias promotion or protection change. Preview: https://idogs-app-staging-ikb6q4kst-izipawsltd-tonys-projects.vercel.app/privacy and /terms.
- Five new rendered-policy tests verify draft/current distinction, ACL preservation, AI choice and shared deletion/billing/retention sections in all three surfaces. Existing request/status/cancel and stale-response regressions also pass. These tests do not prove legal compliance or operational deletion/cancellation capability.
- Read-only production metadata: deployment dpl_Fe5XxYFrDzhw2hNXL7MxLLwHKHkw, source 8941cff8737140c024f35e8bde115107fa84cc4c, READY, regions [iad1]. This is a deployment-region observation, not evidence of all storage, backups or subprocessor locations.
- No API/Rules/Storage/env/Stripe/Resend mutation, real account/dog operation, TestFlight upload, public policy publication, PR merge or App Store submission was performed.
