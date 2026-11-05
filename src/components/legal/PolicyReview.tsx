import AIProviderRetention from './AIProviderRetention'
import { DELETION_POLICY } from '../../../shared/account-deletion-copy.js'

export const DATA_PROCESSING_SUMMARY = 'iDogs uses service providers that may process information outside Australia.'
export const POLICY_REVIEW_VERSION = '6 November 2026'
export const CONSUMER_RIGHTS = 'Nothing in these Terms or our refund policy excludes, restricts or modifies consumer guarantees, remedies or other rights that cannot lawfully be excluded under the Australian Consumer Law or other applicable law.'

// Effective 6 November 2026 — the same deletion wording as idogs.com.au/privacy.
export function DeletionPolicyDraft() {
  return <div data-policy-section="deletion">
    <ul>{DELETION_POLICY.map(point => <li key={point}>{point}</li>)}</ul>
  </div>
}

export function BillingPolicyDraft() {
  return <div data-policy-section="billing">
    <p>Change-of-mind cancellation does not automatically entitle you to a refund for an unused part of a billing period. Refunds and other remedies will be provided where required by applicable law. {CONSUMER_RIGHTS}</p>
  </div>
}

export function InternationalProcessingDraft() {
  return <div data-policy-section="international">
    <p>iDogs uses Firebase/Google for authentication, database and file storage, Vercel for hosting, Stripe for web payments, Resend for email, ClickSend for SMS where enabled, and Anthropic for optional iDogs Scan document reading. Providers may process information outside Australia.</p>
  </div>
}

export function AIScanningDisclosure() {
  return <div data-policy-section="ai">
    <p>If you choose AI document scanning and give permission for that document, iDogs sends the selected photo or PDF to Anthropic to extract dog and health record fields. Documents may contain personal information such as names, addresses and veterinary contact details. You can cancel and use manual entry instead without sending the document for AI scanning.</p>
    <AIProviderRetention />
    <p>When scanning within a dog&apos;s profile, the document is also saved to that profile in iDogs. Check extracted results before saving records. AI output is not a veterinary diagnosis or a guarantee of accuracy.</p>
  </div>
}
