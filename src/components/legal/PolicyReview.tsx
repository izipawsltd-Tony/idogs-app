import AIProviderRetention from './AIProviderRetention'

// Review-only candidate. No effective date or operational feature is enabled here.
export const DATA_PROCESSING_SUMMARY = 'iDogs uses service providers that may process information outside Australia.'
export const POLICY_REVIEW_VERSION = '25 October 2026 — draft, not effective'
export const CONSUMER_RIGHTS = 'Nothing in these Terms or our refund policy excludes, restricts or modifies consumer guarantees, remedies or other rights that cannot lawfully be excluded under the Australian Consumer Law or other applicable law.'

export function PolicyReviewNotice() {
  return <aside role="note" aria-label="Draft policy status" style={{ margin: '16px 0', padding: 16, border: '2px solid #9a6700', borderRadius: 10, background: '#fff8df', color: '#493600', overflowWrap: 'anywhere' }}>
    <strong>Draft for review — not effective</strong>
    <p>The owner has approved the seven-day service target and stopping future renewal on acceptance for implementation. Request status may show a processing target; a target is not confirmation of completion. Deletion requests can currently be submitted and cancelled before processing. Permanent deletion and automatic cancellation of subscription renewal remain unavailable in the live service. This preview does not change your subscription.</p>
  </aside>
}

export function DeletionPolicyDraft() {
  return <div data-policy-section="deletion">
    <p>Proposed policy: initiate account deletion in Settings, verify your identity and explicitly confirm. We aim to complete deletion as soon as practical, with a target of seven calendar days after receiving a valid, authenticated request. This is a proposed service target, not a statutory deadline or a mandatory waiting period.</p>
    <p>If ownership, billing or lawful retention checks prevent completion within that target, we will provide an update within seven calendar days explaining the outstanding issue, the relevant retained data categories and the next update date. We will confirm when deletion is completed. A request receipt means requested, not deleted.</p>
    <p>You can explicitly cancel before processing starts. Signing in does not cancel a request. Under the proposed billing rule, accepting a valid deletion request also stops future subscription renewal. Cancelling the request does not restart a subscription already marked not to renew.</p>
    <p>The seven-day processing target and file recovery period are separate. A deleted file can remain in Google Cloud Storage&apos;s recovery state for seven days from the time that file is deleted. If file deletion occurs later in processing, that recovery period can extend beyond the request target. We must report the remaining step and verify it before confirming completion; reaching a date alone is not proof of deletion.</p>
  </div>
}

export function BillingPolicyDraft() {
  return <div data-policy-section="billing">
    <p>Proposed rule for web subscriptions: when a valid deletion request is accepted, we will arrange and verify that future renewal is cancelled without waiting for account cleanup. Subscription cancellation takes effect at the end of the current paid period; account deletion need not wait until then. Choosing earlier deletion may end access before that paid period expires.</p>
    <p>If cancellation cannot be verified, we will promptly explain the billing issue and escalate it before the next renewal date. An unresolved provider check must not become a silent or indefinite delay. Requesting deletion is not itself proof that cancellation or a refund has been completed.</p>
    <p>Change-of-mind cancellation does not automatically entitle you to a refund for an unused part of a billing period. Refunds and other remedies will be provided where required by applicable law. {CONSUMER_RIGHTS}</p>
  </div>
}

export function RetentionPolicyDraft() {
  return <div data-policy-section="retention">
    <p>We propose to delete or appropriately de-identify personal information that is no longer needed for a permitted purpose, subject to applicable legal retention requirements. Account deletion does not automatically erase records belonging to another current owner. We will assess shared history and remove or de-identify the departing person&apos;s private information where appropriate; shared history is not a blanket reason to retain all personal details indefinitely.</p>
    <p>Only records needed for a documented lawful purpose will be retained, with restricted access and a defined review or disposal date. Company financial records, including relevant invoices and receipts, generally must be retained for at least seven years after the transactions covered by those records are completed. That requirement does not apply to every dog profile, photograph or account field.</p>
    <p>The deletion inventory must also cover public passport data, uploaded media, provider-held copies and backups. Provider and backup deletion schedules must be verified before publication; this draft does not promise immediate removal from every backup or third-party system.</p>
    <p><strong>File recovery copies:</strong> The Storage configuration supplied for review on 25 October 2026 shows a seven-day soft-delete period, object versioning off and no bucket retention policy. Soft-deleted files are recoverable during that period and are not immediately permanently erased. These settings do not establish that there are no older versions, object-level holds, exports or other provider copies. No Storage protection is disabled by this policy.</p>
    <p>Proposed recovery safeguard: deleted account data must not be returned to normal service during recovery. Any authorised disaster recovery must reapply deletion records before restored data becomes available. This safeguard requires operational testing before the policy becomes effective.</p>
    <p><strong>Database backups:</strong> Daily database backups can retain removed account data for seven days after each snapshot. We must account for those copies and prevent deleted information from returning to normal service during a restore. A file recovery check alone does not verify database backup removal.</p>
  </div>
}

export function InternationalProcessingDraft() {
  return <div data-policy-section="international">
    <p>iDogs uses Firebase/Google for authentication, database and file storage, Vercel for hosting, Stripe for web payments, Resend for email, ClickSend for SMS where enabled, and Anthropic for optional AI document scanning. Providers may process information outside Australia. This draft does not promise that all data stays in Australia or Asia-Pacific. Any legacy SMS provider records also require retention review.</p>
    <p>The current default Firestore database and the Storage bucket shown in the configuration evidence are in asia-southeast1 (Singapore). This describes those resources only; it does not establish where every provider, support system or backup processes information.</p>
    <p>Before this policy becomes effective, we must verify provider processing locations, relevant overseas disclosures, contractual safeguards and retention arrangements, and complete the applicable privacy disclosures. No provider training, residency or deletion guarantee is made without that verification.</p>
  </div>
}

export function AIScanningDisclosure() {
  return <div data-policy-section="ai">
    <p>If you choose AI document scanning and give permission for that document, iDogs sends the selected photo or PDF to Anthropic to extract dog and health record fields. Documents may contain personal information such as names, addresses and veterinary contact details. You can cancel and use manual entry instead without sending the document for AI scanning.</p>
    <AIProviderRetention />
    <p>When scanning within a dog&apos;s profile, the document is also saved to that profile in iDogs. Check extracted results before saving records. AI output is not a veterinary diagnosis or a guarantee of accuracy.</p>
  </div>
}
