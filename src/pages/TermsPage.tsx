import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PolicyReviewNotice, POLICY_REVIEW_VERSION, DeletionPolicyDraft, BillingPolicyDraft, RetentionPolicyDraft, InternationalProcessingDraft, AIScanningDisclosure, CONSUMER_RIGHTS } from '../components/legal/PolicyReview'
import {
  PLUS_MONTHLY_PRICE_AUD,
  PLUS_ANNUAL_PRICE_AUD,
  DOG_CAP_FREE,
  DOG_CAP_PLUS,
  LITTER_QUOTA_PLUS_ROLLING_12_MONTHS,
  EXTRA_LITTER_PRICE_AUD,
} from '../lib/pricingCopy'

export default function TermsPage() {
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0)
  }, [])
  const lastUpdated = POLICY_REVIEW_VERSION
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', fontFamily: 'var(--font-body)' }}>
      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ height: 34 }} />
        </Link>
        <Link to="/signup" className="btn btn-primary btn-sm">Start free</Link>
      </nav>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--dark)', marginBottom: 8, letterSpacing: '-0.02em' }}>Terms of Service</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>Review version: {lastUpdated} · iziPaws Pty Ltd ABN 42 693 563 745</p>
          <PolicyReviewNotice />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <LegalSection title="1. Acceptance of Terms">
            <p>This is a proposed revision for iDogs, operated by iziPaws Pty Ltd ABN 42 693 563 745 ("we", "us", "our"). It is not effective and viewing this review does not accept new terms. An effective date and applicable notice process must be confirmed before publication.</p>
            <p>These Terms apply to all users including breeders, pet owners, and visitors.</p>
          </LegalSection>

          <LegalSection title="2. Description of Service">
            <p>iDogs is a SaaS platform that enables Australian dog breeders and pet owners to manage dog health records, vaccination history, pedigree documentation, and compliance reporting. Key features include:</p>
            <ul>
              <li>Digital dog health profiles and QR passports</li>
              <li>AI-powered document scanning</li>
              <li>Vaccination and worming reminders</li>
              <li>Ownership transfer management</li>
              <li>Compliance export reports for Dogs Australia and Australian state regulations</li>
            </ul>
          </LegalSection>

          <LegalSection title="3. Accounts and Registration">
            <p>You must provide accurate, current, and complete information when creating an account. You are responsible for maintaining the confidentiality of your login credentials and for all activities under your account.</p>
            <p>You must be at least 18 years of age to create an account. By registering, you represent that you are 18 or older.</p>
            <p>We reserve the right to suspend or terminate accounts that violate these Terms.</p>
          </LegalSection>

          <LegalSection title="4. Subscription Plans and Billing">
            <p>iDogs offers the following plans and add-ons in Australian dollars. Displayed prices include GST where applicable:</p>
            <ul>
              <li><strong>Free:</strong> Up to {DOG_CAP_FREE} dogs, QR passport, health records, email reminders — free forever</li>
              <li><strong>Plus Monthly — A${PLUS_MONTHLY_PRICE_AUD}/month:</strong> Up to {DOG_CAP_PLUS} dogs, iDogs Document Scans, document storage, PDF/CSV export, and up to {LITTER_QUOTA_PLUS_ROLLING_12_MONTHS} included litters per rolling 365-day period</li>
              <li><strong>Plus Annual — A${PLUS_ANNUAL_PRICE_AUD}/year:</strong> Same Plus features as Plus Monthly, billed annually</li>
              <li><strong>Extra Litter Credit — A${EXTRA_LITTER_PRICE_AUD} each:</strong> A one-time add-on that permits one additional litter after the included litter allowance has been used</li>
            </ul>
            <p>The included litter allowance is linked to your breeder profile rather than to a particular login or subscription period. Cancelling, downgrading, or resubscribing does not reset litter usage within the rolling 365-day period. Changing your login email or using another login linked to the same breeder profile also does not create a new allowance.</p>
            <p>An Extra Litter Credit is linked to the breeder profile that purchased it and is consumed when it is used to activate one additional litter. An unused Extra Litter Credit does not reset the included litter allowance.</p>
            <p>Web subscription payments are processed by Stripe. We do not store your full payment card details. Subscriptions renew at the end of each billing period unless renewal is cancelled. Purchases are unavailable in the current native iPhone app; these web billing terms do not create an in-app purchase facility.</p>
            <p>You may cancel subscription renewal at any time. Ordinary subscription cancellation takes effect at the end of the current paid billing period.</p>
            <BillingPolicyDraft />
          </LegalSection>

          <LegalSection title="5. Acceptable Use">
            <p>You agree not to use the Service to:</p>
            <ul>
              <li>Upload false, misleading, or fraudulent dog health records</li>
              <li>Violate any applicable Australian state or federal laws</li>
              <li>Attempt to gain unauthorised access to other users' accounts or data</li>
              <li>Transmit malware, viruses, or other harmful code</li>
              <li>Scrape, copy, or redistribute content from the Service without permission</li>
              <li>Use the Service for any purpose that violates animal welfare legislation</li>
            </ul>
          </LegalSection>

          <LegalSection title="6. Data and Privacy">
            <p>Your use of the Service is also governed by our <Link to="/privacy" style={{ color: 'var(--green)' }}>Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
            <InternationalProcessingDraft />
            <AIScanningDisclosure />
            <p>You retain ownership of all data you upload to the Service. By uploading data, you grant us a limited licence to store, process, and display it solely for the purpose of providing the Service to you.</p>
          </LegalSection>

          <LegalSection title="7. Intellectual Property">
            <p>The platform, design and brand assets are subject to their applicable intellectual property and licensing rights. Ownership and licensed-use attribution must be verified against the relevant records before this draft becomes effective.</p>
            <p>You retain ownership of all data you upload. You may not copy, modify, distribute, or create derivative works of our platform without prior written consent.</p>
          </LegalSection>

          <LegalSection title="8. Disclaimers and Limitation of Liability">
            <p>{CONSUMER_RIGHTS}</p>
            <p>Subject to those rights, we do not promise uninterrupted or error-free service or indefinite preservation of every record.</p>
            <p>iDogs is a record-keeping tool. It does not provide veterinary, legal, or compliance advice. Users are responsible for ensuring their records meet all applicable regulatory requirements.</p>
            <p>To the maximum extent permitted by Australian law, our liability to you for any loss or damage is limited to the amount you paid us in the 12 months preceding the claim.</p>
          </LegalSection>

          <LegalSection title="9. Termination">
            <p>We may suspend or terminate access for a material breach, unlawful use or a genuine security risk. Where appropriate, we will explain the reason and give reasonable notice and an opportunity to resolve the issue; urgent protective action may be necessary. This clause does not remove applicable consumer rights or remedies.</p>
            <p>Suspension, account deletion and subscription cancellation are separate actions. Any suspension or termination must respect applicable consumer rights. Do not assume cancellation guarantees a fixed export window.</p>
            <DeletionPolicyDraft />
            <RetentionPolicyDraft />
          </LegalSection>

          <LegalSection title="10. Changes to Terms">
            <p>Material revisions require an effective date and advance notice consistent with our existing commitments and applicable law. This draft does not authorise immediate changes to existing contracts or rely on viewing this page as acceptance. Existing published privacy commitments include at least 14 days advance notice of material changes.</p>
          </LegalSection>

          <LegalSection title="11. Governing Law">
            <p>These Terms are governed by the laws of South Australia, Australia, subject to any mandatory applicable laws and consumer rights to bring proceedings in another competent jurisdiction.</p>
          </LegalSection>

          <LegalSection title="12. Contact">
            <p>For questions about these Terms, contact us at:</p>
            <p><strong>iziPaws Pty Ltd</strong><br />ABN: 42 693 563 745<br />Adelaide, South Australia<br />Email: hello@idogs.com.au</p>
          </LegalSection>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--dark)', padding: '24px', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
        © 2026 iDogs · iziPaws Pty Ltd ABN 42 693 563 745 ·{' '}
        <Link to="/privacy" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Privacy Policy</Link>
      </div>
    </div>
  )
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 12, padding: '28px 32px', border: '1px solid var(--border)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 16 }}>{title}</h2>
      <div style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}
